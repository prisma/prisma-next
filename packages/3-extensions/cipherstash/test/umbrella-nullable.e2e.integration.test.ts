/**
 * Nullable umbrella end-to-end against PGlite — pins AC-UMB4
 * (canonical AC list lives in the package`s `DEVELOPING.md §
 * Acceptance criteria → Umbrella round-trips`).
 *
 * Sibling to `umbrella.e2e.integration.test.ts` (search + read-side
 * bulk-call counting on the non-nullable variant). Reuses the same
 * synthetic-EQL-bundle approach but flips the `email` column to
 * `nullable: true` so the mixed-null insert / null-check query /
 * encrypted-equality query / read-side `decryptAll` round-trip can
 * all be exercised on the same fixture.
 *
 * AC-UMB4 (paraphrased): the nullable variant
 * `email: EncryptedString({ equality: true })?` round-trips correctly
 * with a mix of null and non-null rows; `email.isNull()` lowers to
 * `WHERE email IS NULL` directly via `NullCheckExpr` (not an
 * `eql_v2.eq` call); the operator registry is not consulted on null
 * checks.
 *
 * Phases pinned by the single test in this file:
 *
 *   1. **Mixed-null insert** of 10 rows (5 with envelope email, 5
 *      with `null`). Asserts the bulk-encrypt middleware made
 *      exactly one `bulkEncrypt` call and that the call's `values`
 *      slot only carried the 5 non-null plaintexts. The middleware's
 *      `instanceof EncryptedString` filter inside `collectTargets`
 *      handles the skip-nulls behavior; this is the umbrella check
 *      that the filter holds end-to-end.
 *   2. **`isNull()` query**. Lowered SQL is asserted to contain
 *      `IS NULL` and to NOT contain any `eql_v2.` function call —
 *      so the framework`s always-on `isNull` comparison method
 *      short-circuits before any operator-registry dispatch and the
 *      cipherstash operator descriptors are bypassed entirely.
 *      Functional check: returns exactly the 5 null-half rows.
 *   3. **`isNotNull()` query**. Same SQL-shape assertions
 *      mirrored. Functional check: returns exactly the 5 populated-
 *      half rows; each `email` cell is an `EncryptedString` envelope.
 *   4. **`cipherstashEq` query** against one of the populated emails.
 *      The lowering goes through `eql_v2.eq` (an EQL function call,
 *      not a null check); functional check: returns the single
 *      matching row.
 *   5. **`decryptAll` over a mixed (null + populated) result set**.
 *      Asserts exactly one `bulkDecrypt` call carrying only the 5
 *      non-null ciphertexts — the walker passes over the null cells
 *      via `value === null` short-circuit at the visit head.
 *
 * **Synthetic EQL bundle** caveat — same as the sibling umbrella e2e:
 * `eql_v2.eq` and `eql_v2.ilike` are stubbed with cleartext-comparing
 * function bodies so the operator-lowering wire path can reach a real
 * Postgres function call at execute time. The synthetic stub does NOT
 * validate EQL`s correctness against real ciphertexts (out of project
 * scope per the M3 R2 prompt`s explicit "Items the orchestrator has
 * triaged out of scope" list — M4 / post-Project-1 territory).
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapterControl from '@prisma-next/adapter-postgres/control';
import postgresAdapterRuntime from '@prisma-next/adapter-postgres/runtime';
import type { PostgresContract } from '@prisma-next/adapter-postgres/types';
import { executePerSpaceDbApply } from '@prisma-next/cli/control-api';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import postgresDriverControl from '@prisma-next/driver-postgres/control';
import postgresDriverRuntime from '@prisma-next/driver-postgres/runtime';
import sqlFamilyDescriptor, {
  type ExtensionMigrationPackage,
  INIT_ADDITIVE_POLICY,
  type SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import { createControlStack } from '@prisma-next/framework-components/control';
import {
  instantiateExecutionStack,
  type RuntimeExtensionDescriptor,
  type RuntimeTargetDescriptor,
} from '@prisma-next/framework-components/execution';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { writeExtensionMigrationPackage } from '@prisma-next/migration-tools/io';
import { emitPinnedSpaceArtefacts } from '@prisma-next/migration-tools/spaces';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import {
  type AnyExpression,
  ColumnRef,
  InsertAst,
  NullCheckExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { planFromAst } from '@prisma-next/sql-relational-core/plan';
import {
  createExecutionContext,
  createRuntime,
  createSqlExecutionStack,
} from '@prisma-next/sql-runtime';
import postgresTargetControl from '@prisma-next/target-postgres/control';
import postgresTargetRuntime from '@prisma-next/target-postgres/runtime';
import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decryptAll } from '../src/execution/decrypt-all';
import { cipherstashQueryOperations } from '../src/execution/operators';
import cipherstashExtensionDescriptor from '../src/exports/control';
import {
  CIPHERSTASH_INVARIANTS,
  CIPHERSTASH_SPACE_ID,
  CIPHERSTASH_STRING_CODEC_ID,
  EQL_V2_CONFIGURATION_TABLE,
  EQL_V2_ENCRYPTED_TYPE,
  EQL_V2_SCHEMA,
} from '../src/extension-metadata/constants';

// Forward-port (M3.5 R2): the cipherstash contract / baseline migration / head ref
// now flow through on-disk JSON via the descriptor's contractSpace, replacing the
// previous in-memory `core/contract` and `core/migrations` modules.
const cipherstashContractSpace = cipherstashExtensionDescriptor.contractSpace!;
const cipherstashContract = cipherstashContractSpace.contractJson;
const cipherstashBaselineMigration = cipherstashContractSpace.migrations[0]!;
const cipherstashHeadRef = cipherstashContractSpace.headRef;

import { bulkEncryptMiddleware } from '../src/exports/middleware';
import type {
  CipherstashBulkDecryptArgs,
  CipherstashBulkEncryptArgs,
  CipherstashSdk,
  CipherstashSingleDecryptArgs,
} from '../src/exports/runtime';
import { createCipherstashRuntimeDescriptor, EncryptedString } from '../src/exports/runtime';

const APP_CONTRACT_HASH = coreHash('sha256:cipherstash-umbrella-nullable-app-v1');
const APP_PROFILE_HASH = profileHash('sha256:cipherstash-umbrella-nullable-app-profile-v1');
const APP_TABLE = 'User';
const APP_FIELD = 'email';
const ROW_COUNT = 10;
const POPULATED_HALF = 5;

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
            // The whole point of this test fixture: the column is
            // nullable so insert can mix nulls with envelopes and the
            // codec / middleware / decryptAll all participate in the
            // skip-nulls behavior end-to-end.
            nullable: true,
            typeParams: { equality: true, freeTextSearch: true },
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

// Validated form used by the inline `lower(...)` adapter check at the
// `isNull` / `isNotNull` SQL-shape assertion sites. The contract's
// nullable-true `email` column is shared end-to-end so the lowered
// SQL inspection matches the runtime exec.
const validatedAppContract = validateContract<PostgresContract>(
  {
    ...appContract,
    storage: {
      storageHash: appContract.storage.storageHash,
      tables: appContract.storage.tables,
    },
  },
  emptyCodecLookup,
);

const familyInstance = sqlFamilyDescriptor.create(
  createControlStack({
    family: sqlFamilyDescriptor,
    target: postgresTargetControl,
    adapter: postgresAdapterControl,
    driver: postgresDriverControl,
    extensionPacks: [cipherstashExtensionDescriptor],
  }),
);

const frameworkComponents = [
  postgresTargetControl,
  postgresAdapterControl,
  postgresDriverControl,
  cipherstashExtensionDescriptor,
] as const;

/**
 * Synthetic EQL bundle with search-operator stubs. Mirrors the sibling
 * umbrella e2e's stub (composite type + configuration table + add /
 * remove search-config functions + `eq`/`ilike` cleartext stubs).
 */
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
    `CREATE OR REPLACE FUNCTION "${EQL_V2_SCHEMA}".eq(
      a public."${EQL_V2_ENCRYPTED_TYPE}", b public."${EQL_V2_ENCRYPTED_TYPE}"
    ) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
      SELECT (a).data->>'c' = (b).data->>'c'
    $$;`,
    `CREATE OR REPLACE FUNCTION "${EQL_V2_SCHEMA}".ilike(
      a public."${EQL_V2_ENCRYPTED_TYPE}", b public."${EQL_V2_ENCRYPTED_TYPE}"
    ) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
      SELECT (a).data->>'c' ILIKE (b).data->>'c'
    $$;`,
  ].join('\n');
}

function buildSyntheticBaselineMigration(): ExtensionMigrationPackage {
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
          description: 'Synthetic stub bundle with search-operator functions (PGlite-compatible)',
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
    metadata: {
      ...baseMetadata,
      migrationHash: computeMigrationHash(baseMetadata, syntheticOps),
    },
    ops: syntheticOps,
  };
}

interface CounterSdk extends CipherstashSdk {
  readonly bulkEncryptCalls: CipherstashBulkEncryptArgs[];
  readonly bulkDecryptCalls: CipherstashBulkDecryptArgs[];
  readonly singleDecryptCalls: CipherstashSingleDecryptArgs[];
}

function makeCounterSdk(): CounterSdk {
  const bulkEncryptCalls: CipherstashBulkEncryptArgs[] = [];
  const bulkDecryptCalls: CipherstashBulkDecryptArgs[] = [];
  const singleDecryptCalls: CipherstashSingleDecryptArgs[] = [];
  return {
    bulkEncryptCalls,
    bulkDecryptCalls,
    singleDecryptCalls,
    decrypt(args) {
      singleDecryptCalls.push(args);
      const ct = args.ciphertext as { c?: string } | null;
      if (!ct || typeof ct.c !== 'string' || !ct.c.startsWith('ct:')) {
        throw new Error(`mock SDK: cannot decrypt: ${JSON.stringify(args.ciphertext)}`);
      }
      return Promise.resolve(ct.c.slice('ct:'.length));
    },
    bulkEncrypt(args) {
      bulkEncryptCalls.push(args);
      const out = args.values.map((plaintext) => ({
        c: `ct:${plaintext}`,
        t: args.routingKey.table,
        col: args.routingKey.column,
      }));
      return Promise.resolve(out);
    },
    bulkDecrypt(args) {
      bulkDecryptCalls.push(args);
      const out = args.ciphertexts.map((ciphertext) => {
        const ct = ciphertext as { c?: string } | null;
        if (!ct || typeof ct.c !== 'string' || !ct.c.startsWith('ct:')) {
          throw new Error(`mock SDK: cannot bulk-decrypt: ${JSON.stringify(ciphertext)}`);
        }
        return ct.c.slice('ct:'.length);
      });
      return Promise.resolve(out);
    },
  };
}

interface TestProject {
  readonly projectRoot: string;
  readonly migrationsDir: string;
}

async function setupTestProject(args: {
  readonly migration: ExtensionMigrationPackage;
}): Promise<TestProject> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'cipherstash-umbrella-nullable-'));
  const migrationsDir = join(projectRoot, 'migrations');
  await mkdir(migrationsDir, { recursive: true });

  await emitPinnedSpaceArtefacts(migrationsDir, CIPHERSTASH_SPACE_ID, {
    contract: cipherstashContract,
    contractDts: '// rendered .d.ts for cipherstash contract space\nexport interface Contract {}\n',
    headRef: { hash: cipherstashHeadRef.hash, invariants: [...cipherstashHeadRef.invariants] },
  });

  const cipherstashSpaceDir = join(migrationsDir, CIPHERSTASH_SPACE_ID);
  await writeExtensionMigrationPackage(cipherstashSpaceDir, args.migration);

  return { projectRoot, migrationsDir };
}

interface InsertRow {
  readonly id: string;
  readonly email: EncryptedString | null;
}

function buildInsertPlan(rows: ReadonlyArray<InsertRow>) {
  const astRows = rows.map((row) => ({
    id: ParamRef.of(row.id, { codecId: 'pg/text@1', name: 'id' }),
    [APP_FIELD]: ParamRef.of(row.email, {
      codecId: CIPHERSTASH_STRING_CODEC_ID,
      name: APP_FIELD,
    }),
  }));
  const ast = new InsertAst(TableSource.named(APP_TABLE), astRows);
  return planFromAst<Record<string, unknown>>(ast, appContract);
}

interface UserRow {
  readonly id: string;
  readonly email: EncryptedString | null;
}

function buildSelectPlan(where: AnyExpression) {
  const ast = new SelectAst({
    from: TableSource.named(APP_TABLE),
    joins: undefined,
    projection: [
      new ProjectionItem('id', ColumnRef.of(APP_TABLE, 'id'), 'pg/text@1'),
      new ProjectionItem(
        APP_FIELD,
        ColumnRef.of(APP_TABLE, APP_FIELD),
        CIPHERSTASH_STRING_CODEC_ID,
      ),
    ],
    where,
    orderBy: undefined,
    distinct: undefined,
    distinctOn: undefined,
    groupBy: undefined,
    having: undefined,
    limit: undefined,
    offset: undefined,
    selectAllIntent: undefined,
  });
  return planFromAst<UserRow>(ast, appContract);
}

/**
 * Stub runtime target so the inline `lower(...)` SQL-shape check can
 * compose the cipherstash runtime with the Postgres adapter without
 * picking up the postgres package`s test export. Mirrors the helper
 * inlined in `operator-lowering.test.ts`.
 */
const stubRuntimeTarget: RuntimeTargetDescriptor<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  version: '0.0.1',
  familyId: 'sql',
  targetId: 'postgres',
  create() {
    return { familyId: 'sql', targetId: 'postgres' };
  },
};

function makeLoweringAdapter(sdk: CipherstashSdk) {
  const cipherstash: RuntimeExtensionDescriptor<'sql', 'postgres'> =
    createCipherstashRuntimeDescriptor({ sdk });
  return postgresAdapterRuntime.create({
    target: stubRuntimeTarget,
    adapter: postgresAdapterRuntime,
    driver: undefined,
    extensionPacks: [cipherstash],
  });
}

function buildSearchPlan(method: 'cipherstashEq' | 'cipherstashIlike', value: string) {
  const operators = cipherstashQueryOperations();
  const op = operators.find((o) => o.method === method);
  if (!op) {
    throw new Error(`cipherstash operator ${method} not found`);
  }
  const columnAccessor = {
    returnType: { codecId: CIPHERSTASH_STRING_CODEC_ID, nullable: true },
    buildAst: () => ColumnRef.of(APP_TABLE, APP_FIELD),
  };
  const impl = op.impl as unknown as (...args: unknown[]) => { buildAst(): AnyExpression };
  const predicate = impl(columnAccessor, value).buildAst();
  return buildSelectPlan(predicate);
}

describe.sequential(
  'cipherstash nullable umbrella round-trip — mixed-null insert + isNull/isNotNull + cipherstashEq + decryptAll (PGlite, T3.7 / AC-UMB4)',
  { timeout: timeouts.spinUpPpgDev * 2 },
  () => {
    let database: Awaited<ReturnType<typeof createDevDatabase>>;
    let controlDriver: Awaited<ReturnType<typeof postgresDriverControl.create>> | undefined;
    let project: TestProject | undefined;

    beforeAll(async () => {
      database = await createDevDatabase();
    }, timeouts.spinUpPpgDev);

    afterAll(async () => {
      if (database) await database.close();
    }, timeouts.spinUpPpgDev);

    beforeEach(async () => {
      controlDriver = await postgresDriverControl.create(database.connectionString);
      try {
        await controlDriver.query('drop schema if exists public cascade');
        await controlDriver.query(`drop schema if exists "${EQL_V2_SCHEMA}" cascade`);
        await controlDriver.query('drop schema if exists prisma_contract cascade');
        await controlDriver.query('create schema public');

        project = await setupTestProject({ migration: buildSyntheticBaselineMigration() });

        const result = await executePerSpaceDbApply({
          driver: controlDriver,
          familyInstance,
          contract: appContract,
          mode: 'apply',
          migrations: postgresTargetControl.migrations,
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
      } finally {
        await controlDriver.close();
        controlDriver = undefined;
      }
    }, timeouts.spinUpPpgDev);

    afterEach(async () => {
      if (controlDriver) {
        await controlDriver.close();
        controlDriver = undefined;
      }
      if (project) {
        await rm(project.projectRoot, { recursive: true, force: true });
        project = undefined;
      }
    });

    it('mixed-null insert → isNull/isNotNull (no eql_v2 call) → cipherstashEq → decryptAll skips nulls (AC-UMB4)', async () => {
      const sdk = makeCounterSdk();
      const cipherstashRuntime = createCipherstashRuntimeDescriptor({ sdk });

      const stack = createSqlExecutionStack({
        target: postgresTargetRuntime,
        adapter: postgresAdapterRuntime,
        driver: postgresDriverRuntime,
        extensionPacks: [cipherstashRuntime],
      });
      const stackInstance = instantiateExecutionStack(stack);
      const driver = stackInstance.driver;
      if (!driver) {
        throw new Error('Driver descriptor missing from execution stack');
      }
      await driver.connect({ kind: 'url', url: database.connectionString });

      const context = createExecutionContext({
        contract: appContract,
        stack: {
          target: postgresTargetRuntime,
          adapter: postgresAdapterRuntime,
          extensionPacks: [cipherstashRuntime],
        },
      });

      const runtime = createRuntime({
        stackInstance,
        context,
        driver,
        middleware: [bulkEncryptMiddleware(sdk)],
        verify: { mode: 'onFirstUse', requireMarker: false },
      });

      try {
        // ── Phase 1: insert 10 rows, half with envelope, half with null ──
        // Even indices get an envelope; odd indices get null. The split
        // pattern is interleaved (rather than grouped) so the bulk-
        // encrypt middleware's `instanceof EncryptedString` filter has
        // to skip-then-resume across the row sequence — a stricter
        // test than "all nulls trailing the envelopes" or vice versa.
        const rows: InsertRow[] = Array.from({ length: ROW_COUNT }, (_, i) =>
          i % 2 === 0
            ? { id: `user-${i}`, email: EncryptedString.from(`alice${i}@example.com`) }
            : { id: `user-${i}`, email: null },
        );
        const populatedPlaintexts = rows
          .filter((r): r is InsertRow & { email: EncryptedString } => r.email !== null)
          .map((r) => r.email)
          .map((e) => {
            // Fish the original plaintext back out for the
            // assertion below; the envelope's handle is package-
            // private but `decrypt()` returns the cached plaintext
            // synchronously for write-side envelopes (AC-MW5).
            return e;
          });
        expect(populatedPlaintexts).toHaveLength(POPULATED_HALF);

        const insertPlan = buildInsertPlan(rows);
        await runtime.execute(insertPlan).toArray();

        // The middleware skips null cells (via the `instanceof
        // EncryptedString` filter inside `collectTargets`) so the
        // single bulk-encrypt call carries only the populated half.
        expect(sdk.bulkEncryptCalls).toHaveLength(1);
        expect(sdk.bulkEncryptCalls[0]?.routingKey).toEqual({
          table: APP_TABLE,
          column: APP_FIELD,
        });
        expect(sdk.bulkEncryptCalls[0]?.values).toHaveLength(POPULATED_HALF);
        expect(sdk.bulkEncryptCalls[0]?.values).toEqual([
          'alice0@example.com',
          'alice2@example.com',
          'alice4@example.com',
          'alice6@example.com',
          'alice8@example.com',
        ]);

        // ── Phase 2: isNull() lowers without consulting the registry ──
        const isNullPlan = buildSelectPlan(
          NullCheckExpr.isNull(ColumnRef.of(APP_TABLE, APP_FIELD)),
        );
        const isNullLowered = makeLoweringAdapter(sdk).lower(isNullPlan.ast, {
          contract: validatedAppContract,
        });
        // The lowered SQL must mention `IS NULL` and must NOT call
        // any cipherstash function — confirms the framework's always-
        // on `isNull` short-circuit at the `NullCheckExpr` AST level
        // (no operator-registry dispatch).
        expect(isNullLowered.sql).toContain('IS NULL');
        expect(isNullLowered.sql).not.toContain('eql_v2.');
        expect(isNullLowered.params).toEqual([]);

        const isNullResults = await runtime.execute(isNullPlan).toArray();
        expect(isNullResults).toHaveLength(ROW_COUNT - POPULATED_HALF);
        const isNullIds = isNullResults.map((r) => r.id).sort();
        expect(isNullIds).toEqual(['user-1', 'user-3', 'user-5', 'user-7', 'user-9']);
        for (const row of isNullResults) {
          expect(row.email).toBeNull();
        }

        // ── Phase 3: isNotNull() — same SQL-shape assertions ──
        const isNotNullPlan = buildSelectPlan(
          NullCheckExpr.isNotNull(ColumnRef.of(APP_TABLE, APP_FIELD)),
        );
        const isNotNullLowered = makeLoweringAdapter(sdk).lower(isNotNullPlan.ast, {
          contract: validatedAppContract,
        });
        expect(isNotNullLowered.sql).toContain('IS NOT NULL');
        expect(isNotNullLowered.sql).not.toContain('eql_v2.');
        expect(isNotNullLowered.params).toEqual([]);

        const isNotNullResults = await runtime.execute(isNotNullPlan).toArray();
        expect(isNotNullResults).toHaveLength(POPULATED_HALF);
        const isNotNullIds = isNotNullResults.map((r) => r.id).sort();
        expect(isNotNullIds).toEqual(['user-0', 'user-2', 'user-4', 'user-6', 'user-8']);
        for (const row of isNotNullResults) {
          expect(row.email).toBeInstanceOf(EncryptedString);
        }

        // ── Phase 4: cipherstashEq returns the single matching row ──
        const eqPlan = buildSearchPlan('cipherstashEq', 'alice4@example.com');
        const eqResults = await runtime.execute(eqPlan).toArray();
        expect(eqResults).toHaveLength(1);
        expect(eqResults[0]?.id).toBe('user-4');
        expect(eqResults[0]?.email).toBeInstanceOf(EncryptedString);

        // The cipherstashEq operator wraps its argument in an
        // EncryptedString envelope and the bulk-encrypt middleware
        // therefore issues a second `bulkEncrypt` call (one envelope
        // = one batch) before the SELECT runs against the synthetic
        // `eql_v2.eq` function.
        expect(sdk.bulkEncryptCalls).toHaveLength(2);

        // ── Phase 5: decryptAll over a mixed (null + populated) result ──
        // Build a synthetic mixed result set by interleaving the
        // null half and the populated half. The walker must pass
        // over the null cells (via the `value === null` short-circuit
        // at the visit head) and only count the populated envelopes
        // toward the bulkDecrypt call.
        const mixedRows = [
          ...isNotNullResults,
          ...isNullResults, // these have email: null
        ];
        expect(mixedRows).toHaveLength(ROW_COUNT);
        expect(sdk.bulkDecryptCalls).toHaveLength(0);

        await decryptAll(mixedRows);

        expect(sdk.bulkDecryptCalls).toHaveLength(1);
        expect(sdk.bulkDecryptCalls[0]?.routingKey).toEqual({
          table: APP_TABLE,
          column: APP_FIELD,
        });
        expect(sdk.bulkDecryptCalls[0]?.ciphertexts).toHaveLength(POPULATED_HALF);

        // Cached plaintexts now resolve synchronously without
        // additional SDK calls (AC-DEC3).
        const populatedSorted = [...isNotNullResults].sort((a, b) => a.id.localeCompare(b.id));
        const decrypted = await Promise.all(
          populatedSorted.map((row) => {
            const e = row.email;
            if (!e) throw new Error('expected envelope in isNotNull result');
            return e.decrypt();
          }),
        );
        expect(decrypted).toEqual([
          'alice0@example.com',
          'alice2@example.com',
          'alice4@example.com',
          'alice6@example.com',
          'alice8@example.com',
        ]);
        expect(sdk.singleDecryptCalls).toHaveLength(0);

        // ── Phase 6: decryptAll on a fully-null slice is a no-op ──
        await decryptAll(isNullResults);
        expect(sdk.bulkDecryptCalls).toHaveLength(1); // unchanged
      } finally {
        await runtime.close();
      }
    });
  },
);
