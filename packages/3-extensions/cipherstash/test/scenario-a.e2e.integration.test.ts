/**
 * Scenario A end-to-end against PGlite.
 *
 * Drives the CLI per-space `db init` flow (`executePerSpaceDbApply`)
 * against a real Postgres (PGlite via `createDevDatabase`) with
 * cipherstash wired as an extension space and the
 * `cipherstash:string@1` codec hook attached to a searchable
 * `Encrypted<String>` column on the application contract.
 *
 * Three layers of coverage:
 *
 *   1. **Byte-equivalence (disk).** The pinned
 *      `migrations/cipherstash/<dirName>/ops.json` carries the vendored
 *      `EQL_BUNDLE_SQL` byte-for-byte (single-string `execute[0].sql`).
 *
 *   2. **Multi-space planning (real bundle).** Calling
 *      `executePerSpaceDbApply` with `mode: 'plan'` on the *real*
 *      cipherstash descriptor (full vendored bundle) produces a plan
 *      that includes:
 *
 *        - the cipherstash baseline ops (bundle + structural ops), and
 *        - the app-space `CREATE TABLE User` op, and
 *        - the codec-hook-emitted `add_search_config@v1` op for
 *          `User.email`.
 *
 *      This locks the codec-hook contract validated by the first real
 *      consumer plus the planning half of multi-space ordering
 *      preserved through `concatenateSpaceApplyInputs`.
 *
 *   3. **Multi-space apply (synthetic bundle).** Same wiring as test
 *      (2), but with a synthetic cipherstash baseline whose `installEql
 *      Bundle` op SQL is a PGlite-compatible stub instead of the real
 *      vendored bundle. This lets us exercise:
 *
 *        - the runner's `executeAcrossSpaces` single-tx path,
 *        - marker rows for both `app` and `cipherstash` spaces,
 *        - the codec-hook-emitted `add_search_config` SQL actually
 *          executing (the stub provides a one-line
 *          `eql_v2.add_search_config` function), and
 *        - an insert + select round-trip through the bundle's
 *          `eql_v2_encrypted` composite type.
 *
 *      The synthetic bundle is the smallest stub that lets the codec
 *      hook's emitted SQL run successfully — see
 *      {@link buildSyntheticEqlBundleSql} for what it includes (and
 *      {@link SYNTHETIC_BUNDLE_RATIONALE} for why).
 *
 * **Why split into two apply paths?** The real `EQL_BUNDLE_SQL`
 * includes `CREATE EXTENSION IF NOT EXISTS pgcrypto` which PGlite does
 * not ship (verified by enumerating
 * `node_modules/.pnpm/@electric-sql+pglite@0.3.14/.../contrib/`).
 * Trying to apply the real bundle aborts PGlite at the WASM level
 * (`RuntimeError: unreachable`). The synthetic-bundle apply path here
 * verifies the framework + codec wiring against a real database; the
 * real-bundle apply against a real Postgres (with `pgcrypto`) is
 * exercised by the example app's e2e setup.
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapterDescriptor from '@prisma-next/adapter-postgres/control';
import { executePerSpaceDbApply } from '@prisma-next/cli/control-api';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import postgresDriverDescriptor from '@prisma-next/driver-postgres/control';
import sqlFamilyDescriptor, {
  INIT_ADDITIVE_POLICY,
  type SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { writeExtensionMigrationPackage } from '@prisma-next/migration-tools/io';
import type { MigrationPackage } from '@prisma-next/migration-tools/package';
import { emitPinnedSpaceArtefacts } from '@prisma-next/migration-tools/spaces';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import postgresTargetDescriptor from '@prisma-next/target-postgres/control';
import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import cipherstashExtensionDescriptor from '../src/exports/control';
import {
  CIPHERSTASH_INVARIANTS,
  CIPHERSTASH_SPACE_ID,
  CIPHERSTASH_STRING_CODEC_ID,
  EQL_V2_CONFIGURATION_TABLE,
  EQL_V2_ENCRYPTED_TYPE,
  EQL_V2_SCHEMA,
} from '../src/extension-metadata/constants';
import { EQL_BUNDLE_SQL } from '../src/migration/eql-bundle';

const cipherstashContractSpace = cipherstashExtensionDescriptor.contractSpace!;
const cipherstashContract = cipherstashContractSpace.contractJson;
const cipherstashBaselineMigration = cipherstashContractSpace.migrations[0]!;
const cipherstashHeadRef = cipherstashContractSpace.headRef;
const CIPHERSTASH_STORAGE_HASH = cipherstashContract.storage.storageHash;

const APP_CONTRACT_HASH = coreHash('sha256:cipherstash-e2e-app-v1');
const APP_PROFILE_HASH = profileHash('sha256:cipherstash-e2e-app-profile-v1');
const APP_TABLE = 'User';
const APP_FIELD = 'email';
const ADD_SEARCH_CONFIG_INVARIANT_ID =
  `cipherstash-codec:${APP_TABLE}.${APP_FIELD}:add-search-config:match@v1` as const;

const appContract: Contract<SqlStorage> = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: APP_PROFILE_HASH,
  storage: {
    storageHash: APP_CONTRACT_HASH,
    tables: {
      [APP_TABLE]: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          [APP_FIELD]: {
            codecId: CIPHERSTASH_STRING_CODEC_ID,
            nativeType: EQL_V2_ENCRYPTED_TYPE,
            nullable: false,
            typeParams: { freeTextSearch: true },
          },
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

const familyInstance = sqlFamilyDescriptor.create(
  createControlStack({
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: postgresAdapterDescriptor,
    driver: postgresDriverDescriptor,
    extensionPacks: [cipherstashExtensionDescriptor],
  }),
);

const frameworkComponents = [
  postgresTargetDescriptor,
  postgresAdapterDescriptor,
  postgresDriverDescriptor,
  cipherstashExtensionDescriptor,
] as const;

/**
 * Synthetic stand-in for the vendored `EQL_BUNDLE_SQL`. The real bundle
 * declares `CREATE EXTENSION IF NOT EXISTS pgcrypto`, which PGlite does
 * not ship — so an end-to-end apply through PGlite needs a stub that
 * creates only the typed objects + functions the codec hook touches.
 * This keeps the framework / hook wiring under test against a real
 * database while the *real* bundle's apply is exercised in R4 against a
 * pgcrypto-equipped Postgres.
 *
 * Includes:
 *   - `eql_v2` schema (for the function namespace)
 *   - `public.eql_v2_encrypted` composite type (so the app's `User.email`
 *     column type resolves)
 *   - `public.eql_v2_configuration` table (so the codec hook's
 *     `add_search_config` SQL has a row to insert)
 *   - `eql_v2.add_search_config(table, field, index, cast_as)` —
 *     SQL-language stub that records the call in
 *     `eql_v2_configuration` so the test can assert the hook's SQL
 *     actually ran.
 *   - `eql_v2.remove_search_config(table, field)` — paired drop, kept
 *     for symmetry / future Scenario B.
 */
const SYNTHETIC_BUNDLE_RATIONALE =
  'See block comment above buildSyntheticEqlBundleSql for the rationale.';

function buildSyntheticEqlBundleSql(): string {
  return [
    `CREATE SCHEMA IF NOT EXISTS "${EQL_V2_SCHEMA}";`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${EQL_V2_ENCRYPTED_TYPE}') THEN
        CREATE TYPE public."${EQL_V2_ENCRYPTED_TYPE}" AS (data jsonb);
      END IF;
    END $$;`,
    `CREATE TABLE IF NOT EXISTS public."${EQL_V2_CONFIGURATION_TABLE}" (
      id serial PRIMARY KEY,
      "table" text NOT NULL,
      "column" text NOT NULL,
      index_name text NOT NULL,
      cast_as text NOT NULL
    );`,
    `CREATE OR REPLACE FUNCTION "${EQL_V2_SCHEMA}".add_search_config(
      p_table text, p_column text, p_index text, p_cast_as text
    ) RETURNS void LANGUAGE sql AS $$
      INSERT INTO public."${EQL_V2_CONFIGURATION_TABLE}" ("table", "column", index_name, cast_as)
      VALUES (p_table, p_column, p_index, p_cast_as);
    $$;`,
    `CREATE OR REPLACE FUNCTION "${EQL_V2_SCHEMA}".remove_search_config(
      p_table text, p_column text, p_index text
    ) RETURNS void LANGUAGE sql AS $$
      DELETE FROM public."${EQL_V2_CONFIGURATION_TABLE}"
      WHERE "table" = p_table AND "column" = p_column AND index_name = p_index;
    $$;`,
  ].join('\n');
}

/**
 * Build a synthetic-bundle variant of `cipherstashBaselineMigration`.
 * Identical structure to the real package — same dirName, same
 * structural ops, same headRef hash semantics — but with the
 * `installEqlBundle` op's SQL replaced by
 * {@link buildSyntheticEqlBundleSql}. The migrationHash is recomputed
 * because the on-disk representation differs.
 */
function buildSyntheticBaselineMigration(): MigrationPackage {
  const realOps = cipherstashBaselineMigration.ops;
  const syntheticOps = realOps.map((op) => {
    const sqlOp = op as unknown as SqlMigrationPlanOperation<unknown>;
    if (sqlOp.invariantId !== CIPHERSTASH_INVARIANTS.installBundle) {
      return op;
    }
    return {
      ...sqlOp,
      execute: [
        {
          description: 'Synthetic stub bundle (PGlite-compatible)',
          sql: buildSyntheticEqlBundleSql(),
        },
      ],
    };
  });

  const baseMetadata = {
    from: cipherstashBaselineMigration.metadata.from,
    to: cipherstashBaselineMigration.metadata.to,
    fromContract: cipherstashBaselineMigration.metadata.fromContract,
    toContract: cipherstashBaselineMigration.metadata.toContract,
    hints: cipherstashBaselineMigration.metadata.hints,
    labels: cipherstashBaselineMigration.metadata.labels,
    providedInvariants: cipherstashBaselineMigration.metadata.providedInvariants,
    createdAt: cipherstashBaselineMigration.metadata.createdAt,
  };

  return {
    dirName: cipherstashBaselineMigration.dirName,
    dirPath: cipherstashBaselineMigration.dirName,
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
  readonly cipherstashBaselineDir: string;
}

async function setupTestProject(args: {
  readonly migration: MigrationPackage;
}): Promise<TestProject> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'cipherstash-scenario-a-'));
  const migrationsDir = join(projectRoot, 'migrations');
  await mkdir(migrationsDir, { recursive: true });

  await emitPinnedSpaceArtefacts(migrationsDir, CIPHERSTASH_SPACE_ID, {
    contract: cipherstashContract,
    contractDts: '// rendered .d.ts for cipherstash contract space\nexport interface Contract {}\n',
    headRef: { hash: cipherstashHeadRef.hash, invariants: [...cipherstashHeadRef.invariants] },
  });

  const cipherstashSpaceDir = join(migrationsDir, CIPHERSTASH_SPACE_ID);
  await writeExtensionMigrationPackage(cipherstashSpaceDir, args.migration);

  return {
    projectRoot,
    migrationsDir,
    cipherstashBaselineDir: join(cipherstashSpaceDir, args.migration.dirName),
  };
}

describe.sequential(
  'cipherstash Scenario A end-to-end (PGlite)',
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
      await driver.query(`drop schema if exists "${EQL_V2_SCHEMA}" cascade`);
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
     * Byte-equivalence: the bundle SQL flowed through
     * `installEqlBundleOp.execute[0].sql` and was serialised to the
     * on-disk `ops.json` byte-for-byte.
     */
    it('pinned ops.json carries the EQL bundle byte-for-byte', async () => {
      project = await setupTestProject({ migration: cipherstashBaselineMigration });
      const opsPath = join(project.cipherstashBaselineDir, 'ops.json');
      const opsRaw = await readFile(opsPath, 'utf-8');
      const ops = JSON.parse(opsRaw) as ReadonlyArray<{
        readonly invariantId?: string;
        readonly execute?: ReadonlyArray<{ readonly sql: string }>;
      }>;
      const installOp = ops.find((op) => op.invariantId === CIPHERSTASH_INVARIANTS.installBundle);
      expect(installOp).toBeDefined();
      expect(installOp?.execute?.[0]?.sql).toBe(EQL_BUNDLE_SQL);
    });

    /**
     * Plan-only against the real cipherstash descriptor + bundle.
     *
     * `executePerSpaceDbApply` runs the planner against the live
     * (empty) database, including the codec-hook integration through
     * `extractCodecControlHooks` + `planFieldEventOperations`, but
     * stops short of applying. This validates:
     *
     *   - the cipherstash codec hook fires for `User.email`, emitting
     *     a `cipherstash-codec:User.email:add-search-config:match@v1` op
     *     (per-flag invariantId shape — see
     *     {@link ADD_SEARCH_CONFIG_INVARIANT_ID});
     *   - both spaces are present in the plan output, with cipherstash
     *     ops ordered before app-space ops (per
     *     `concatenateSpaceApplyInputs`).
     */
    it('mode=plan against the real bundle produces a multi-space plan with the codec-hook op', async () => {
      project = await setupTestProject({ migration: cipherstashBaselineMigration });

      const result = await executePerSpaceDbApply({
        driver: driver!,
        familyInstance,
        contract: appContract,
        mode: 'plan',
        migrations: postgresTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents],
        migrationsDir: project.migrationsDir,
        extensionContractSpaces: [{ id: CIPHERSTASH_SPACE_ID }],
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
        (id: string) => id === 'cipherstash.install-eql-bundle',
      );
      const appUserIdx = opIdsInOrder.findIndex((id: string) => id.includes(APP_TABLE));
      const codecHookIdx = opIdsInOrder.findIndex((id: string) =>
        id.includes(`cipherstash-codec.${APP_TABLE}.${APP_FIELD}.add-search-config`),
      );

      // Cipherstash baseline ops must come before app-space ops
      // (alphabetical space-id ordering inside `concatenateSpaceApplyInputs`);
      // the codec hook fires inside the app-space plan and must therefore
      // land after the bundle but is otherwise positioned by the planner.
      // The plan-level operation shape (DbInitSuccess.plan.operations) only
      // exposes id/label/operationClass — invariantId tracking happens at
      // the marker level (covered by the apply test below).
      expect(installIdx).toBeGreaterThanOrEqual(0);
      expect(appUserIdx).toBeGreaterThan(installIdx);
      expect(codecHookIdx).toBeGreaterThan(installIdx);
    });

    /**
     * Multi-space apply against the synthetic bundle — see the file
     * comment for {@link SYNTHETIC_BUNDLE_RATIONALE}.
     *
     * Asserts:
     *   - both spaces' marker rows present with correct hashes and
     *     `applied_invariants` matching the pinned head ref;
     *   - the codec hook's `add_search_config` SQL actually executed
     *     (the synthetic stub records the call into
     *     `eql_v2_configuration`);
     *   - the `User` table exists with the `eql_v2_encrypted` column;
     *   - an insert + select round-trip through the composite type
     *     works against a real database.
     */
    it('synthetic bundle: applies cipherstash + app-space atomically; markers, hook side-effect, and round-trip all OK', async () => {
      project = await setupTestProject({ migration: buildSyntheticBaselineMigration() });

      const result = await executePerSpaceDbApply({
        driver: driver!,
        familyInstance,
        contract: appContract,
        mode: 'apply',
        migrations: postgresTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents],
        migrationsDir: project.migrationsDir,
        extensionContractSpaces: [{ id: CIPHERSTASH_SPACE_ID }],
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
      expect(markerBySpace.has(CIPHERSTASH_SPACE_ID)).toBe(true);

      expect(markerBySpace.get(CIPHERSTASH_SPACE_ID)?.core_hash).toBe(CIPHERSTASH_STORAGE_HASH);
      expect([...(markerBySpace.get(CIPHERSTASH_SPACE_ID)?.invariants ?? [])].sort()).toEqual(
        [...cipherstashHeadRef.invariants].sort(),
      );

      expect(markerBySpace.get('app')?.core_hash).toBe(APP_CONTRACT_HASH);
      expect(markerBySpace.get('app')?.invariants ?? []).toContain(ADD_SEARCH_CONFIG_INVARIANT_ID);

      const userTable = await driver!.query<{ exists: boolean }>(
        `select to_regclass('public."${APP_TABLE}"') is not null as exists`,
      );
      expect(userTable.rows[0]?.exists).toBe(true);

      const configRows = await driver!.query<{ table: string; column: string; index_name: string }>(
        `select "table", "column", index_name from public."${EQL_V2_CONFIGURATION_TABLE}"
         where "table" = $1 and "column" = $2`,
        [APP_TABLE, APP_FIELD],
      );
      expect(configRows.rows.length).toBe(1);
      expect(configRows.rows[0]?.index_name).toBe('match');

      const payload = JSON.stringify({ c: 'ct-payload-1', i: { t: APP_TABLE, c: APP_FIELD } });
      await driver!.query(
        `insert into public."${APP_TABLE}" ("id", "${APP_FIELD}")
         values ($1, ROW($2::jsonb)::public."${EQL_V2_ENCRYPTED_TYPE}")`,
        ['user-1', payload],
      );
      const row = await driver!.query<{ id: string; payload: string }>(
        `select "id", ("${APP_FIELD}").data::text as payload from public."${APP_TABLE}"`,
      );
      expect(row.rows.length).toBe(1);
      expect(row.rows[0]?.id).toBe('user-1');
      expect(row.rows[0]?.payload).toContain('ct-payload-1');
    });
  },
);

// Touch the constant to keep the lint happy when the file's only
// substantive use of it is inside a comment block.
void SYNTHETIC_BUNDLE_RATIONALE;
