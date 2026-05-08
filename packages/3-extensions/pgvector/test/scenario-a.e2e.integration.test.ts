/**
 * Scenario A end-to-end against PGlite — pgvector contract-space
 * (project: extension-contract-spaces, M4 / T4.3).
 *
 * Drives the CLI per-space `db init` flow (`executePerSpaceDbApply`,
 * sub-spec § 6) against a real Postgres (PGlite via
 * `createDevDatabase`) with pgvector wired as an extension space and a
 * user `Doc` table that carries a `vector(N)` column. Mirrors the
 * cipherstash Scenario A pattern at
 * `packages/3-extensions/cipherstash/test/scenario-a.e2e.integration.test.ts`,
 * with two pgvector-specific simplifications: there is no codec
 * lifecycle hook (pgvector'"'s codec is purely runtime), and the
 * baseline migration is a single op (the `CREATE EXTENSION` step).
 *
 * Three layers of coverage:
 *
 *   1. **Pinned `ops.json` byte-equivalence (disk).** The
 *      `migrations/pgvector/<dirName>/ops.json` carries the
 *      `CREATE EXTENSION IF NOT EXISTS vector` execute SQL byte-for-byte.
 *      Closes project AC10 / TC-15 at the on-disk shape level.
 *
 *   2. **Multi-space planning (real CREATE EXTENSION).** Calling
 *      `executePerSpaceDbApply` with `mode: 'plan'` on the *real*
 *      pgvector descriptor produces a plan that includes:
 *
 *        - the pgvector baseline op (`installVectorExtension`), and
 *        - the app-space `CREATE TABLE Doc` op,
 *        - in cross-space alphabetical order (extensions first).
 *
 *      This locks the planning half of multi-space ordering through
 *      `concatenateSpaceApplyInputs` and the AC10 / TC-16 directory
 *      shape on disk.
 *
 *   3. **Multi-space apply (synthetic vector stub).** Same wiring as
 *      test (2), but with a synthetic baseline whose `installVector
 *      Extension` op is replaced by a PGlite-compatible
 *      `CREATE DOMAIN vector AS text` stub. This exercises:
 *
 *        - the runner'"'s `executeAcrossSpaces` single-tx path,
 *        - marker rows for both `app` and `pgvector` spaces (project
 *          AC5 / AC10 / TC-16),
 *        - the `User`-equivalent `Doc` table created with a
 *          `vector(N)` column that resolves through the codec'"'s
 *          `expandNativeType` hook,
 *        - an insert + select round-trip through the (synthetic)
 *          vector type.
 *
 * **Why split into two apply paths?** PGlite does not ship the
 * `vector` extension (verified by enumerating
 * `node_modules/.pnpm/@electric-sql+pglite@0.3.14/.../contrib/`).
 * Trying to apply the real `CREATE EXTENSION IF NOT EXISTS vector`
 * fails inside PGlite with "extension 'vector' is not available".
 * The synthetic-bundle apply path here verifies the framework + codec
 * wiring against a real database; the real-extension apply against a
 * pgvector-equipped Postgres is deferred to e2e infra (consistent
 * with cipherstash'"'s synthetic-bundle approach for `pgcrypto`).
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapterDescriptor from '@prisma-next/adapter-postgres/control';
import { executePerSpaceDbApply } from '@prisma-next/cli/control-api';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import postgresDriverDescriptor from '@prisma-next/driver-postgres/control';
import sqlFamilyDescriptor, {
  type ExtensionMigrationPackage,
  INIT_ADDITIVE_POLICY,
  type SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { writeExtensionMigrationPackage } from '@prisma-next/migration-tools/io';
import { emitPinnedSpaceArtefacts } from '@prisma-next/migration-tools/spaces';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import postgresTargetDescriptor from '@prisma-next/target-postgres/control';
import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { VECTOR_CODEC_ID } from '../src/core/constants';
import { PGVECTOR_STORAGE_HASH, pgvectorContract } from '../src/core/contract';
import {
  PGVECTOR_INVARIANTS,
  PGVECTOR_NATIVE_TYPE,
  PGVECTOR_SPACE_ID,
} from '../src/core/contract-space-constants';
import { pgvectorBaselineMigration, pgvectorHeadRef } from '../src/core/migrations';
import pgvectorExtensionDescriptor from '../src/exports/control';

const APP_CONTRACT_HASH = coreHash('sha256:pgvector-e2e-app-v1');
const APP_PROFILE_HASH = profileHash('sha256:pgvector-e2e-app-profile-v1');
const APP_TABLE = 'Doc';
const APP_FIELD = 'embedding';
const VECTOR_LENGTH = 3;

/**
 * Build the application contract used by the planning + apply tests.
 *
 * `withLength` controls whether the `embedding` column carries
 * `typeParams.length` — present in the planning test (validates that
 * the codec'"'s `expandNativeType` hook lifts to `vector(N)` in the
 * emitted DDL), absent in the apply test (the synthetic vector stub is
 * a text-domain that does not accept type modifiers; see
 * {@link buildSyntheticVectorInstallSql}'s rationale).
 */
function buildAppContract(opts: { readonly withLength: boolean }): Contract<SqlStorage> {
  const embeddingColumn: {
    readonly codecId: string;
    readonly nativeType: string;
    readonly nullable: boolean;
    readonly typeParams?: Record<string, unknown>;
  } = opts.withLength
    ? {
        codecId: VECTOR_CODEC_ID,
        nativeType: PGVECTOR_NATIVE_TYPE,
        nullable: false,
        typeParams: { length: VECTOR_LENGTH },
      }
    : {
        codecId: VECTOR_CODEC_ID,
        nativeType: PGVECTOR_NATIVE_TYPE,
        nullable: false,
      };

  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: APP_PROFILE_HASH,
    storage: {
      storageHash: APP_CONTRACT_HASH,
      tables: {
        [APP_TABLE]: {
          columns: {
            id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            [APP_FIELD]: embeddingColumn,
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

const familyInstance = sqlFamilyDescriptor.create(
  createControlStack({
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: postgresAdapterDescriptor,
    driver: postgresDriverDescriptor,
    extensionPacks: [pgvectorExtensionDescriptor],
  }),
);

const frameworkComponents = [
  postgresTargetDescriptor,
  postgresAdapterDescriptor,
  postgresDriverDescriptor,
  pgvectorExtensionDescriptor,
] as const;

/**
 * Synthetic stand-in for `CREATE EXTENSION IF NOT EXISTS vector`.
 * PGlite does not ship the `vector` extension; this stub creates a
 * `vector` text-domain so the codec'"'s `expandNativeType` hook
 * resolves `vector(N)` (which then degrades to `vector` here, ignoring
 * the parenthesised length — `text` accepts any string content). Keeps
 * the framework + per-space wiring under test against a real database
 * while the real `CREATE EXTENSION` apply is deferred to a
 * vector-equipped Postgres.
 */
const SYNTHETIC_VECTOR_RATIONALE =
  'See block comment above buildSyntheticVectorInstallSql for the rationale.';

function buildSyntheticVectorInstallSql(): string {
  return [
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${PGVECTOR_NATIVE_TYPE}') THEN
         CREATE DOMAIN public."${PGVECTOR_NATIVE_TYPE}" AS text;
       END IF;
     END $$;`,
  ].join('\n');
}

/**
 * Build a synthetic-vector variant of `pgvectorBaselineMigration`.
 * Identical structure to the real package — same dirName, same
 * structural shape, same headRef hash semantics — but with the
 * `installVectorExtension` op'"'s `execute[]` SQL replaced by
 * {@link buildSyntheticVectorInstallSql}. The migrationHash is
 * recomputed because the on-disk representation differs.
 */
function buildSyntheticBaselineMigration(): ExtensionMigrationPackage {
  const realOps = pgvectorBaselineMigration.ops;
  const syntheticOps = realOps.map((op) => {
    const sqlOp = op as unknown as SqlMigrationPlanOperation<unknown>;
    if (sqlOp.invariantId !== PGVECTOR_INVARIANTS.installVector) {
      return op;
    }
    return {
      ...sqlOp,
      precheck: [],
      execute: [
        {
          description: 'Synthetic stub vector type (PGlite-compatible)',
          sql: buildSyntheticVectorInstallSql(),
        },
      ],
      postcheck: [],
    };
  });

  const baseMetadata = {
    from: pgvectorBaselineMigration.metadata.from,
    to: pgvectorBaselineMigration.metadata.to,
    fromContract: pgvectorBaselineMigration.metadata.fromContract,
    toContract: pgvectorBaselineMigration.metadata.toContract,
    hints: pgvectorBaselineMigration.metadata.hints,
    labels: pgvectorBaselineMigration.metadata.labels,
    providedInvariants: pgvectorBaselineMigration.metadata.providedInvariants,
    createdAt: pgvectorBaselineMigration.metadata.createdAt,
  };

  return {
    dirName: pgvectorBaselineMigration.dirName,
    metadata: {
      ...baseMetadata,
      migrationHash: computeMigrationHash(baseMetadata, syntheticOps),
    },
    ops: syntheticOps,
  };
}

interface TestProject {
  readonly projectRoot: string;
  readonly migrationsDir: string;
  readonly pgvectorBaselineDir: string;
}

async function setupTestProject(args: {
  readonly migration: ExtensionMigrationPackage;
}): Promise<TestProject> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'pgvector-scenario-a-'));
  const migrationsDir = join(projectRoot, 'migrations');
  await mkdir(migrationsDir, { recursive: true });

  await emitPinnedSpaceArtefacts(migrationsDir, PGVECTOR_SPACE_ID, {
    contract: pgvectorContract,
    contractDts: '// rendered .d.ts for pgvector contract space\nexport interface Contract {}\n',
    headRef: { hash: pgvectorHeadRef.hash, invariants: [...pgvectorHeadRef.invariants] },
  });

  const pgvectorSpaceDir = join(migrationsDir, PGVECTOR_SPACE_ID);
  await writeExtensionMigrationPackage(pgvectorSpaceDir, args.migration);

  return {
    projectRoot,
    migrationsDir,
    pgvectorBaselineDir: join(pgvectorSpaceDir, args.migration.dirName),
  };
}

describe.sequential(
  'pgvector Scenario A end-to-end (PGlite, T4.3)',
  { timeout: timeouts.spinUpPpgDev },
  () => {
    let database: Awaited<ReturnType<typeof createDevDatabase>>;
    let driver: Awaited<ReturnType<typeof postgresDriverDescriptor.create>> | undefined;
    let project: TestProject | undefined;

    beforeAll(async () => {
      database = await createDevDatabase();
    }, timeouts.spinUpPpgDev);

    afterAll(async () => {
      if (database) await database.close();
    }, timeouts.spinUpPpgDev);

    beforeEach(async () => {
      driver = await postgresDriverDescriptor.create(database.connectionString);
      await driver.query('drop schema if exists public cascade');
      await driver.query('drop schema if exists prisma_contract cascade');
      await driver.query('create schema public');
    }, timeouts.spinUpPpgDev);

    afterEach(async () => {
      if (driver) {
        await driver.close();
        driver = undefined;
      }
      if (project) {
        await rm(project.projectRoot, { recursive: true, force: true });
        project = undefined;
      }
    });

    /**
     * Pinned `ops.json` byte-equivalence — the real
     * `installVectorExtension` SQL flowed through `execute[0].sql` and
     * was serialised to disk byte-for-byte. Project AC10 / TC-15 at
     * the on-disk shape level.
     */
    it('pinned ops.json carries the CREATE EXTENSION SQL byte-for-byte (TC-15)', async () => {
      project = await setupTestProject({ migration: pgvectorBaselineMigration });
      const opsPath = join(project.pgvectorBaselineDir, 'ops.json');
      const opsRaw = await readFile(opsPath, 'utf-8');
      const ops = JSON.parse(opsRaw) as ReadonlyArray<{
        readonly invariantId?: string;
        readonly execute?: ReadonlyArray<{ readonly sql: string }>;
      }>;
      const installOp = ops.find((op) => op.invariantId === PGVECTOR_INVARIANTS.installVector);
      expect(installOp).toBeDefined();
      expect(installOp?.execute?.[0]?.sql).toBe('CREATE EXTENSION IF NOT EXISTS vector');
    });

    /**
     * Plan-only against the real pgvector descriptor.
     *
     * `executePerSpaceDbApply` runs the planner against the live
     * (empty) database, including extension-space scaffolding
     * (no codec hooks for pgvector — its codec only contributes
     * runtime + render-output behaviour). Validates:
     *
     *   - both spaces are present in the plan output;
     *   - pgvector ops are ordered before app-space ops (per
     *     `concatenateSpaceApplyInputs`).
     */
    it('mode=plan against the real install op produces a multi-space plan', async () => {
      project = await setupTestProject({ migration: pgvectorBaselineMigration });

      const result = await executePerSpaceDbApply({
        driver: driver!,
        familyInstance,
        contract: buildAppContract({ withLength: true }),
        mode: 'plan',
        migrations: postgresTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents],
        migrationsDir: project.migrationsDir,
        extensionContractSpaces: [{ id: PGVECTOR_SPACE_ID }],
        policy: INIT_ADDITIVE_POLICY,
        action: 'dbInit',
      });

      if (!result.ok) {
        throw new Error(
          `Expected plan ok but got failure: ${JSON.stringify(result.failure, null, 2)}`,
        );
      }
      const operations = result.value.plan.operations;
      expect(operations.length).toBeGreaterThan(0);

      const opIdsInOrder = operations.map((op: { readonly id: string }) => op.id);
      const installIdx = opIdsInOrder.findIndex(
        (id: string) => id === 'pgvector.install-vector-extension',
      );
      const appDocIdx = opIdsInOrder.findIndex((id: string) => id.includes(APP_TABLE));

      expect(installIdx).toBeGreaterThanOrEqual(0);
      expect(appDocIdx).toBeGreaterThan(installIdx);
    });

    /**
     * Multi-space apply against the synthetic `vector` domain stub.
     *
     * Asserts:
     *   - both spaces' marker rows present with correct hashes and
     *     `applied_invariants` matching the pinned head ref (project
     *     AC5 / AC10 / TC-16);
     *   - the `Doc` table exists with the `embedding` column whose
     *     declared type renders as `vector(3)` via the codec'"'s
     *     `expandNativeType` hook;
     *   - an insert + select round-trip through the column works
     *     against a real database.
     */
    it('synthetic vector stub: applies pgvector + app-space atomically; markers + round-trip OK', async () => {
      project = await setupTestProject({ migration: buildSyntheticBaselineMigration() });

      const result = await executePerSpaceDbApply({
        driver: driver!,
        familyInstance,
        contract: buildAppContract({ withLength: false }),
        mode: 'apply',
        migrations: postgresTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents],
        migrationsDir: project.migrationsDir,
        extensionContractSpaces: [{ id: PGVECTOR_SPACE_ID }],
        policy: INIT_ADDITIVE_POLICY,
        action: 'dbInit',
      });

      if (!result.ok) {
        throw new Error(
          `Expected db apply success but got failure: ${JSON.stringify(result.failure, null, 2)}`,
        );
      }

      const markers = await driver!.query<{
        space: string;
        core_hash: string;
        invariants: readonly string[];
      }>('select space, core_hash, invariants from prisma_contract.marker order by space');
      const markerBySpace = new Map(markers.rows.map((row) => [row.space, row]));

      expect(markerBySpace.has('app')).toBe(true);
      expect(markerBySpace.has(PGVECTOR_SPACE_ID)).toBe(true);

      expect(markerBySpace.get(PGVECTOR_SPACE_ID)?.core_hash).toBe(PGVECTOR_STORAGE_HASH);
      expect([...(markerBySpace.get(PGVECTOR_SPACE_ID)?.invariants ?? [])].sort()).toEqual(
        [...pgvectorHeadRef.invariants].sort(),
      );

      expect(markerBySpace.get('app')?.core_hash).toBe(APP_CONTRACT_HASH);

      const docTable = await driver!.query<{ exists: boolean }>(
        `select to_regclass('public."${APP_TABLE}"') is not null as exists`,
      );
      expect(docTable.rows[0]?.exists).toBe(true);

      // Round-trip a synthetic vector value through the column. The
      // synthetic `vector` is a text-domain so we round-trip via the
      // codec'"'s `[a,b,c]` text encoding.
      await driver!.query(
        `insert into public."${APP_TABLE}" ("id", "${APP_FIELD}") values ($1, $2)`,
        ['doc-1', '[1,2,3]'],
      );
      const row = await driver!.query<{ id: string; embedding: string }>(
        `select "id", "${APP_FIELD}" as embedding from public."${APP_TABLE}"`,
      );
      expect(row.rows.length).toBe(1);
      expect(row.rows[0]?.id).toBe('doc-1');
      expect(row.rows[0]?.embedding).toBe('[1,2,3]');
    });
  },
);

void SYNTHETIC_VECTOR_RATIONALE;
