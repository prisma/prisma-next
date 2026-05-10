import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { executeDbInit, executeDbUpdate } from '@prisma-next/cli/control-api';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type {
  CodecControlHooks,
  SqlControlExtensionDescriptor,
  SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  MigrationPlanOperation,
  OpFactoryCall,
} from '@prisma-next/framework-components/control';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { materialiseMigrationPackage } from '@prisma-next/migration-tools/io';
import { emitContractSpaceArtefacts } from '@prisma-next/migration-tools/spaces';
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
 * End-to-end coverage for the CLI aggregate `db init` / `db update`
 * pipeline against a real SQLite database with on-disk
 * artefacts.
 *
 * Locks the CLI-level half of:
 *
 * - AM4 (rollback semantics) — multi-space failure rolls back every
 *   space's writes and preserves pre-execution markers.
 * - AM9 (atomic init across spaces).
 * - AM10 (only the bumped extension advances on a follow-up update).
 * - AM11 (codec hooks fire through the aggregate-pipeline path —
 *   loader → `planAggregate` synth strategy → `frameworkComponents`).
 *
 * Companion to the unit-level tests in `@prisma-next/cli` that mock
 * the planner / runner. The runner-level half of AM12 is locked by
 * `runner.multi-space.test.ts`.
 */

const EXT_SPACE_ID = 'test_contract_space_sqlite';
const EXT_BASELINE_DIR = '20260101T0000_create_helper';

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

interface ContractSpaceArtefactSetup {
  readonly migrationsDir: string;
}

async function writeExtensionContractSpaceArtefacts(args: {
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
}): Promise<ContractSpaceArtefactSetup> {
  const migrationsDir = join(args.tmpDir, 'migrations');
  await mkdir(migrationsDir, { recursive: true });

  await emitContractSpaceArtefacts(migrationsDir, EXT_SPACE_ID, {
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
  await materialiseMigrationPackage(spaceDir, {
    dirName: args.migrationDirName,
    metadata: { ...baseMeta, migrationHash },
    ops: [...args.ops],
  });

  return { migrationsDir };
}

/**
 * Build a structurally-valid `SqlControlExtensionDescriptor` with the
 * `contractSpace` field the aggregate loader inspects. The descriptor's
 * `contractJson` is the same reference the test will pass to the loader,
 * and `headRef.hash` matches the on-disk on-disk head ref so drift
 * detection passes. Other descriptor fields (`create`, `migrations`)
 * are unused on the `db init` / `db update` path — the loader reads
 * migrations from disk and `create()` is only invoked on the
 * `migrate` path. They are stubbed minimally to satisfy the type.
 */
function buildExtensionPack(args: {
  readonly contractJson: Contract<SqlStorage>;
  readonly headHash: string;
}): SqlControlExtensionDescriptor<'sqlite'> {
  const stubInstance = {
    familyId: 'sql' as const,
    targetId: 'sqlite' as const,
  };
  return {
    kind: 'extension',
    id: EXT_SPACE_ID,
    familyId: 'sql',
    targetId: 'sqlite',
    version: '0.0.0-test',
    contractSpace: {
      contractJson: args.contractJson,
      migrations: [],
      headRef: { hash: args.headHash, invariants: [] },
    },
    create: () => stubInstance,
  } as unknown as SqlControlExtensionDescriptor<'sqlite'>;
}

describe(
  'db init / db update aggregate pipeline (CLI) - sqlite',
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
      testDb = db;
      tmpDirCleanup = undefined;
      return db.path.replace(/\/test\.db$/, '');
    }

    async function setupBaseline(tmpDir: string): Promise<ContractSpaceArtefactSetup> {
      return writeExtensionContractSpaceArtefacts({
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
      const { migrationsDir } = await setupBaseline(tmpDir);

      const result = await executeDbInit({
        driver: testDb!.driver,
        familyInstance,
        contract: appContract,
        mode: 'apply',
        migrations: sqliteTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents],
        migrationsDir,
        targetId: 'sqlite',
        extensionPacks: [
          buildExtensionPack({
            contractJson: extContractV1,
            headHash: extContractV1.storage.storageHash,
          }),
        ],
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

    it('advances only the bumped extension space when re-running with a new head (locks AM10)', async () => {
      const tmpDir = createTmpDir();
      const baseline = await setupBaseline(tmpDir);

      const initResult = await executeDbInit({
        driver: testDb!.driver,
        familyInstance,
        contract: appContract,
        mode: 'apply',
        migrations: sqliteTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents],
        migrationsDir: baseline.migrationsDir,
        targetId: 'sqlite',
        extensionPacks: [
          buildExtensionPack({
            contractJson: extContractV1,
            headHash: extContractV1.storage.storageHash,
          }),
        ],
      });
      expect(initResult.ok).toBe(true);

      // Bump the extension to v2: emit the v2 head ref + a follow-on
      // migration package. The on-disk graph now has two edges
      // (null→v1, v1→v2); the marker is at v1 so only the second edge
      // walks.
      await emitContractSpaceArtefacts(baseline.migrationsDir, EXT_SPACE_ID, {
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
        await materialiseMigrationPackage(join(baseline.migrationsDir, EXT_SPACE_ID), {
          dirName: '20260201T0000_add_note',
          metadata: { ...baseMeta, migrationHash: computeMigrationHash(baseMeta, ops) },
          ops,
        });
      }

      const updateResult = await executeDbUpdate({
        driver: testDb!.driver,
        familyInstance,
        contract: appContract,
        mode: 'apply',
        migrations: sqliteTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents],
        migrationsDir: baseline.migrationsDir,
        targetId: 'sqlite',
        extensionPacks: [
          buildExtensionPack({
            contractJson: extContractV2,
            headHash: extContractV2.storage.storageHash,
          }),
        ],
        acceptDataLoss: true,
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
      expect(markers.rows.find((r) => r.space === EXT_SPACE_ID)!.core_hash).toBe(
        extContractV2.storage.storageHash,
      );

      const helperTables = await testDb!.driver.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='_ext_helper'",
      );
      const helperCols = await testDb!.driver.query<{ name: string }>(
        'PRAGMA table_info(_ext_helper)',
      );
      expect(helperTables.rows.length).toBe(1);
      expect(helperCols.rows.map((c) => c.name).sort()).toEqual(['id', 'note']);
    });

    it('fires the codec onFieldEvent hook on app-space field add through the aggregate pipeline (M2 R1 wiring still flows through the synth strategy)', async () => {
      const tmpDir = createTmpDir();
      const { migrationsDir } = await setupBaseline(tmpDir);

      const HOOKED_CODEC = 'cs/string@1';
      const hookFiredFor: string[] = [];
      const hooks: CodecControlHooks = {
        onFieldEvent: (event, ctx) => {
          hookFiredFor.push(`${event}:${ctx.tableName}.${ctx.fieldName}`);
          const op: SqlMigrationPlanOperation<unknown> = {
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
          };
          const call: OpFactoryCall = {
            factoryName: op.id,
            operationClass: op.operationClass,
            label: op.label,
            renderTypeScript: () => `${op.id}()`,
            importRequirements: () => [],
            toOp: () => op,
          };
          return [call];
        },
      };

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

      const result = await executeDbInit({
        driver: testDb!.driver,
        familyInstance,
        contract: hookedAppContract,
        mode: 'apply',
        migrations: sqliteTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents, codecHookComponent],
        migrationsDir,
        targetId: 'sqlite',
        extensionPacks: [
          buildExtensionPack({
            contractJson: extContractV1,
            headHash: extContractV1.storage.storageHash,
          }),
        ],
      });

      if (!result.ok) {
        throw new Error(`Expected ok but got failure: ${JSON.stringify(result.failure, null, 2)}`);
      }
      expect(result.ok).toBe(true);

      expect(hookFiredFor).toContain('added:user.email');

      // The codec-emitted op was included in the aggregate operations
      // surfaced to the caller (proves the codec hook flows through
      // executeDbInit → planAggregate (synth strategy) →
      // frameworkComponents).
      const ids = result.value.plan.operations.map((op) => op.id);
      expect(ids).toContain('codec.added.user.email');
    });

    it('rolls back ALL spaces and preserves pre-execution markers when any space fails (locks AM4-rollback CLI half)', async () => {
      const tmpDir = createTmpDir();
      const baseline = await setupBaseline(tmpDir);

      const initResult = await executeDbInit({
        driver: testDb!.driver,
        familyInstance,
        contract: appContract,
        mode: 'apply',
        migrations: sqliteTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents],
        migrationsDir: baseline.migrationsDir,
        targetId: 'sqlite',
        extensionPacks: [
          buildExtensionPack({
            contractJson: extContractV1,
            headHash: extContractV1.storage.storageHash,
          }),
        ],
      });
      expect(initResult.ok).toBe(true);

      const markersBefore = await testDb!.driver.query<{ space: string; core_hash: string }>(
        'SELECT space, core_hash FROM _prisma_marker ORDER BY space',
      );
      const appHashBefore = markersBefore.rows.find((r) => r.space === 'app')!.core_hash;
      const extHashBefore = markersBefore.rows.find((r) => r.space === EXT_SPACE_ID)!.core_hash;

      // Bump extension to v2 with a *failing* op.
      await emitContractSpaceArtefacts(baseline.migrationsDir, EXT_SPACE_ID, {
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
        await materialiseMigrationPackage(join(baseline.migrationsDir, EXT_SPACE_ID), {
          dirName: '20260201T0000_failing',
          metadata: { ...baseMeta, migrationHash: computeMigrationHash(baseMeta, ops) },
          ops,
        });
      }

      const updateResult = await executeDbUpdate({
        driver: testDb!.driver,
        familyInstance,
        contract: appContract,
        mode: 'apply',
        migrations: sqliteTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents],
        migrationsDir: baseline.migrationsDir,
        targetId: 'sqlite',
        extensionPacks: [
          buildExtensionPack({
            contractJson: extContractV2,
            headHash: extContractV2.storage.storageHash,
          }),
        ],
        acceptDataLoss: true,
      });

      expect(updateResult.ok).toBe(false);
      if (updateResult.ok) throw new Error('expected failure');
      expect(updateResult.failure.code).toBe('RUNNER_FAILED');
      expect(updateResult.failure.meta).toMatchObject({ failingSpace: EXT_SPACE_ID });

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
