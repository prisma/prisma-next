import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { executePerSpaceDbApply } from '@prisma-next/cli/control-api';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { CodecControlHooks } from '@prisma-next/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { writeExtensionMigrationPackage } from '@prisma-next/migration-tools/io';
import { emitPinnedSpaceArtefacts } from '@prisma-next/migration-tools/spaces';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import {
  contract as appContract,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  sqliteTargetDescriptor,
  type TestDatabase,
} from './fixtures/runner-fixtures';

/**
 * End-to-end T2.5 — drives the CLI per-space `db init` / `db update`
 * flow (`executePerSpaceDbApply`, sub-spec § 6) against a real SQLite
 * database with on-disk pinned artefacts.
 *
 * Locks the CLI-level half of AM4-rollback + AM9 + AM10 + AM11, and
 * substantially advances AM12 (the runner-level half is covered by
 * `runner.multi-space.test.ts`). Companion to the unit-level tests in
 * `@prisma-next/cli` that mock the planner / runner.
 *
 * @see docs/architecture docs/adrs/ADR 211 - Contract spaces.md
 */

const EXT_SPACE_ID = 'test_contract_space_sqlite';
const EXT_BASELINE_DIR = '20260101T0000_create_helper';

// The on-disk `providedInvariants` aggregate only counts `data`-class
// ops with an `invariantId` (see
// `migration-tools/src/invariants.ts.deriveProvidedInvariants`). The
// synthetic ops here are additive DDL, so we keep `providedInvariants`
// empty + no required invariants on the head ref. Invariant gating is
// covered by dedicated tests in `migration-tools` and the planner.

function buildExtensionContract(version: 1 | 2): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash(`sha256:ext-test-v${version}`),
    storage: {
      storageHash: coreHash(`sha256:ext-contract-v${version}`),
      tables: {
        _ext_helper: {
          columns: {
            id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
            ...(version === 2
              ? {
                  note: { nativeType: 'text', codecId: 'sqlite/text@1', nullable: true },
                }
              : {}),
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    roots: {},
    models: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

const extContractV1 = buildExtensionContract(1);
const extContractV2 = buildExtensionContract(2);

// SQL-family planner ops carry runtime-specific fields (`target`,
// `precheck`, `execute`, `postcheck`) on top of the framework-level
// `MigrationPlanOperation` shape. Tests author the runtime shape and
// cast to `MigrationPlanOperation` because the on-disk `ops.json`
// schema is intentionally light (sub-spec § 1, AM3) — the SQL runner
// reads the additional fields at execution time.
function buildBaselineOps(): readonly MigrationPlanOperation[] {
  return [
    {
      id: 'ext.create-helper',
      label: 'Create extension helper table',
      operationClass: 'additive',
      target: {
        id: 'sqlite',
        details: { schema: 'main', objectType: 'table', name: '_ext_helper' },
      },
      precheck: [],
      execute: [
        {
          description: 'create _ext_helper',
          sql: 'CREATE TABLE _ext_helper (id INTEGER PRIMARY KEY)',
        },
      ],
      postcheck: [],
    } as unknown as MigrationPlanOperation,
  ];
}

function buildAdvanceOps(): readonly MigrationPlanOperation[] {
  return [
    {
      id: 'ext.add-helper.note',
      label: 'Add note column to _ext_helper',
      operationClass: 'additive',
      target: {
        id: 'sqlite',
        details: { schema: 'main', objectType: 'table', name: '_ext_helper' },
      },
      precheck: [],
      execute: [
        {
          description: 'add note column',
          sql: 'ALTER TABLE _ext_helper ADD COLUMN note TEXT',
        },
      ],
      postcheck: [],
    } as unknown as MigrationPlanOperation,
  ];
}

function buildFailingOps(): readonly MigrationPlanOperation[] {
  return [
    {
      id: 'ext.always-fails',
      label: 'Always-failing extension op',
      operationClass: 'additive',
      target: {
        id: 'sqlite',
        details: { schema: 'main', objectType: 'table', name: '_ext_helper' },
      },
      precheck: [],
      execute: [
        {
          description: 'forced failure',
          sql: "SELECT raise(ABORT, 'forced failure')",
        },
      ],
      postcheck: [],
    } as unknown as MigrationPlanOperation,
  ];
}

interface PinnedArtefactSetup {
  readonly migrationsDir: string;
}

async function writePinnedExtensionArtefacts(args: {
  readonly tmpDir: string;
  readonly contract: Contract<SqlStorage>;
  readonly headHash: string;
  readonly invariants: readonly string[];
  readonly migrationDirName: string;
  readonly fromHash: string | null;
  readonly toHash: string;
  readonly ops: readonly MigrationPlanOperation[];
  readonly toContract: Contract<SqlStorage>;
  readonly providedInvariants: readonly string[];
}): Promise<PinnedArtefactSetup> {
  const migrationsDir = join(args.tmpDir, 'migrations');
  await mkdir(migrationsDir, { recursive: true });

  await emitPinnedSpaceArtefacts(migrationsDir, EXT_SPACE_ID, {
    contract: args.contract,
    contractDts: '// placeholder\nexport {};\n',
    headRef: { hash: args.headHash, invariants: [...args.invariants] },
  });

  const spaceDir = join(migrationsDir, EXT_SPACE_ID);
  const baseMeta = {
    from: args.fromHash,
    to: args.toHash,
    fromContract: null,
    toContract: args.toContract,
    hints: { used: [], applied: [], plannerVersion: '2.0.0' },
    labels: [],
    providedInvariants: [...args.providedInvariants],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const migrationHash = computeMigrationHash(baseMeta, [...args.ops]);
  await writeExtensionMigrationPackage(spaceDir, {
    dirName: args.migrationDirName,
    metadata: { ...baseMeta, migrationHash },
    ops: [...args.ops],
  });

  return { migrationsDir };
}

describe(
  'executePerSpaceDbApply (CLI per-space db init/update) - sqlite',
  { timeout: timeouts.databaseOperation },
  () => {
    let testDb: TestDatabase | undefined;
    let tmpDirCleanup: (() => void) | undefined;

    afterEach(() => {
      testDb?.cleanup();
      testDb = undefined;
      tmpDirCleanup?.();
      tmpDirCleanup = undefined;
    });

    function createTmpDir(): string {
      const db = createTestDatabase();
      // Re-use the createTestDatabase tmp area to keep cleanup centralised:
      // its cleanup() rmrf's the directory.
      testDb = db;
      tmpDirCleanup = undefined;
      return db.path.replace(/\/test\.db$/, '');
    }

    async function setupBaselinePinned(tmpDir: string): Promise<PinnedArtefactSetup> {
      return writePinnedExtensionArtefacts({
        tmpDir,
        contract: extContractV1,
        headHash: extContractV1.storage.storageHash,
        invariants: [],
        migrationDirName: EXT_BASELINE_DIR,
        fromHash: null,
        toHash: extContractV1.storage.storageHash,
        ops: buildBaselineOps(),
        toContract: extContractV1,
        providedInvariants: [],
      });
    }

    it('initialises both spaces atomically on a fresh database (locks AM9, AM11 prerequisites)', async () => {
      const tmpDir = createTmpDir();
      const { migrationsDir } = await setupBaselinePinned(tmpDir);

      const result = await executePerSpaceDbApply({
        driver: testDb!.driver,
        familyInstance,
        contract: appContract,
        mode: 'apply',
        migrations: sqliteTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents],
        migrationsDir,
        extensionContractSpaces: [{ id: EXT_SPACE_ID }],
        policy: { allowedOperationClasses: ['additive'] },
        action: 'dbInit',
      });

      if (!result.ok) {
        throw new Error(`Expected ok but got failure: ${JSON.stringify(result.failure, null, 2)}`);
      }
      expect(result.ok).toBe(true);

      const markers = await testDb!.driver.query<{ space: string; core_hash: string }>(
        'SELECT space, core_hash FROM _prisma_marker ORDER BY space',
      );
      expect(markers.rows.map((r) => r.space).sort()).toEqual(['app', EXT_SPACE_ID].sort());
      expect(markers.rows.find((r) => r.space === 'app')!.core_hash).toBe(
        appContract.storage.storageHash,
      );
      expect(markers.rows.find((r) => r.space === EXT_SPACE_ID)!.core_hash).toBe(
        extContractV1.storage.storageHash,
      );

      const userTable = await testDb!.driver.query<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = 'user'",
      );
      expect(userTable.rows[0]!.cnt).toBe(1);

      const helperTable = await testDb!.driver.query<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = '_ext_helper'",
      );
      expect(helperTable.rows[0]!.cnt).toBe(1);
    });

    it('advances only the bumped extension space when re-running with a new pinned head (locks AM10)', async () => {
      const tmpDir = createTmpDir();
      const baseline = await setupBaselinePinned(tmpDir);

      // First apply: both spaces initialised at v1.
      const initResult = await executePerSpaceDbApply({
        driver: testDb!.driver,
        familyInstance,
        contract: appContract,
        mode: 'apply',
        migrations: sqliteTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents],
        migrationsDir: baseline.migrationsDir,
        extensionContractSpaces: [{ id: EXT_SPACE_ID }],
        policy: { allowedOperationClasses: ['additive'] },
        action: 'dbInit',
      });
      expect(initResult.ok).toBe(true);

      // Bump the extension to v2: emit the v2 head ref + a follow-on
      // migration package. The on-disk graph now has two edges
      // (null→v1, v1→v2); the marker is at v1 so only the second edge
      // walks.
      await emitPinnedSpaceArtefacts(baseline.migrationsDir, EXT_SPACE_ID, {
        contract: extContractV2,
        contractDts: '// placeholder\nexport {};\n',
        headRef: { hash: extContractV2.storage.storageHash, invariants: [] },
      });
      {
        const baseMeta = {
          from: extContractV1.storage.storageHash,
          to: extContractV2.storage.storageHash,
          fromContract: null,
          toContract: extContractV2,
          hints: { used: [], applied: [], plannerVersion: '2.0.0' },
          labels: [],
          providedInvariants: [],
          createdAt: '2026-02-01T00:00:00.000Z',
        };
        const ops = [...buildAdvanceOps()];
        await writeExtensionMigrationPackage(join(baseline.migrationsDir, EXT_SPACE_ID), {
          dirName: '20260201T0000_add_note',
          metadata: { ...baseMeta, migrationHash: computeMigrationHash(baseMeta, ops) },
          ops,
        });
      }

      const updateResult = await executePerSpaceDbApply({
        driver: testDb!.driver,
        familyInstance,
        contract: appContract,
        mode: 'apply',
        migrations: sqliteTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents],
        migrationsDir: baseline.migrationsDir,
        extensionContractSpaces: [{ id: EXT_SPACE_ID }],
        policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
        action: 'dbUpdate',
      });
      if (!updateResult.ok) {
        throw new Error(
          `Expected update ok but got failure: ${JSON.stringify(updateResult.failure, null, 2)}`,
        );
      }
      expect(updateResult.ok).toBe(true);

      const markers = await testDb!.driver.query<{ space: string; core_hash: string }>(
        'SELECT space, core_hash FROM _prisma_marker ORDER BY space',
      );
      expect(markers.rows.find((r) => r.space === 'app')!.core_hash).toBe(
        appContract.storage.storageHash,
      );
      // The extension marker advances to v2.
      expect(markers.rows.find((r) => r.space === EXT_SPACE_ID)!.core_hash).toBe(
        extContractV2.storage.storageHash,
      );

      // The new column is present.
      const helperTables = await testDb!.driver.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='_ext_helper'",
      );
      const helperCols = await testDb!.driver.query<{ name: string }>(
        'PRAGMA table_info(_ext_helper)',
      );
      expect(helperTables.rows.length).toBe(1);
      expect(helperCols.rows.map((c) => c.name).sort()).toEqual(['id', 'note']);
    });

    it('fires the codec onFieldEvent hook on app-space field add through the per-space db init flow (M2 R1 wiring still flows through T2.3)', async () => {
      const tmpDir = createTmpDir();
      const { migrationsDir } = await setupBaselinePinned(tmpDir);

      const HOOKED_CODEC = 'cs/string@1';
      const hookFiredFor: string[] = [];
      const hooks: CodecControlHooks = {
        onFieldEvent: (event, ctx) => {
          hookFiredFor.push(`${event}:${ctx.tableName}.${ctx.fieldName}`);
          return [
            {
              id: `codec.${event}.${ctx.tableName}.${ctx.fieldName}`,
              label: `${event} hook on ${ctx.tableName}.${ctx.fieldName}`,
              operationClass: 'additive',
              invariantId: `cs:${ctx.tableName}.${ctx.fieldName}@${event}`,
              target: { id: 'sqlite' },
              precheck: [],
              execute: [
                {
                  description: 'codec side-effect (no-op for test)',
                  sql: 'SELECT 1',
                },
              ],
              postcheck: [],
            },
          ];
        },
      };

      // Override the app contract's `email` codec to one that has a
      // hook attached. The hook returns an additional op; we then
      // verify the planner inlined it into the executed plan.
      const hookedAppContract: Contract<SqlStorage> = {
        ...appContract,
        storage: {
          ...appContract.storage,
          storageHash: coreHash('sha256:app-with-hooked-email'),
          tables: {
            user: {
              ...appContract.storage.tables['user']!,
              columns: {
                ...appContract.storage.tables['user']!.columns,
                email: {
                  nativeType: 'text',
                  codecId: HOOKED_CODEC,
                  nullable: false,
                },
              },
            },
          },
        },
        profileHash: profileHash('sha256:app-with-hooked-email'),
      };

      const codecHookComponent: TargetBoundComponentDescriptor<'sql', 'sqlite'> = {
        kind: 'adapter',
        id: 'test-codec-hook',
        familyId: 'sql',
        targetId: 'sqlite',
        version: '0.0.0-test',
        types: { codecTypes: { controlPlaneHooks: { [HOOKED_CODEC]: hooks } } },
      } as TargetBoundComponentDescriptor<'sql', 'sqlite'>;

      const result = await executePerSpaceDbApply({
        driver: testDb!.driver,
        familyInstance,
        contract: hookedAppContract,
        mode: 'apply',
        migrations: sqliteTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents, codecHookComponent],
        migrationsDir,
        extensionContractSpaces: [{ id: EXT_SPACE_ID }],
        policy: { allowedOperationClasses: ['additive'] },
        action: 'dbInit',
      });

      if (!result.ok) {
        throw new Error(`Expected ok but got failure: ${JSON.stringify(result.failure, null, 2)}`);
      }
      expect(result.ok).toBe(true);

      // The codec hook fired for the new `email` field added in the
      // app-space contract.
      expect(hookFiredFor).toContain('added:user.email');

      // The codec-emitted op was included in the aggregate operations
      // surfaced to the caller (proves the codec hook flows through
      // `executePerSpaceDbApply` → planner.plan → `frameworkComponents`,
      // i.e. the M2 R1 wiring still works under the per-space surface).
      const ids = result.value.plan.operations.map((op) => op.id);
      expect(ids).toContain('codec.added.user.email');
    });

    it('rolls back ALL spaces and preserves pre-execution markers when any space fails (locks AM4-rollback CLI half)', async () => {
      const tmpDir = createTmpDir();
      const baseline = await setupBaselinePinned(tmpDir);

      // First apply: both spaces initialised at v1.
      const initResult = await executePerSpaceDbApply({
        driver: testDb!.driver,
        familyInstance,
        contract: appContract,
        mode: 'apply',
        migrations: sqliteTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents],
        migrationsDir: baseline.migrationsDir,
        extensionContractSpaces: [{ id: EXT_SPACE_ID }],
        policy: { allowedOperationClasses: ['additive'] },
        action: 'dbInit',
      });
      expect(initResult.ok).toBe(true);

      const markersBefore = await testDb!.driver.query<{ space: string; core_hash: string }>(
        'SELECT space, core_hash FROM _prisma_marker ORDER BY space',
      );
      const appHashBefore = markersBefore.rows.find((r) => r.space === 'app')!.core_hash;
      const extHashBefore = markersBefore.rows.find((r) => r.space === EXT_SPACE_ID)!.core_hash;

      // Bump extension to v2 with a *failing* op.
      await emitPinnedSpaceArtefacts(baseline.migrationsDir, EXT_SPACE_ID, {
        contract: extContractV2,
        contractDts: '// placeholder\nexport {};\n',
        headRef: { hash: extContractV2.storage.storageHash, invariants: [] },
      });
      {
        const baseMeta = {
          from: extContractV1.storage.storageHash,
          to: extContractV2.storage.storageHash,
          fromContract: null,
          toContract: extContractV2,
          hints: { used: [], applied: [], plannerVersion: '2.0.0' },
          labels: [],
          providedInvariants: [],
          createdAt: '2026-02-01T00:00:00.000Z',
        };
        const ops = [...buildFailingOps()];
        await writeExtensionMigrationPackage(join(baseline.migrationsDir, EXT_SPACE_ID), {
          dirName: '20260201T0000_failing',
          metadata: { ...baseMeta, migrationHash: computeMigrationHash(baseMeta, ops) },
          ops,
        });
      }

      const updateResult = await executePerSpaceDbApply({
        driver: testDb!.driver,
        familyInstance,
        contract: appContract,
        mode: 'apply',
        migrations: sqliteTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents],
        migrationsDir: baseline.migrationsDir,
        extensionContractSpaces: [{ id: EXT_SPACE_ID }],
        policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
        action: 'dbUpdate',
      });

      expect(updateResult.ok).toBe(false);
      if (updateResult.ok) throw new Error('expected failure');
      expect(updateResult.failure.code).toBe('RUNNER_FAILED');
      expect(updateResult.failure.meta).toMatchObject({ failingSpace: EXT_SPACE_ID });

      // Both markers preserved at their pre-`executeAcrossSpaces` values.
      const markersAfter = await testDb!.driver.query<{ space: string; core_hash: string }>(
        'SELECT space, core_hash FROM _prisma_marker ORDER BY space',
      );
      expect(markersAfter.rows.find((r) => r.space === 'app')!.core_hash).toBe(appHashBefore);
      expect(markersAfter.rows.find((r) => r.space === EXT_SPACE_ID)!.core_hash).toBe(
        extHashBefore,
      );
    });
  },
);
