/**
 * Full umbrella end-to-end against PGlite — cipherstash plan.md
 * § T3.5 + § T3.6 (search half of AC-UMB1 + AC-UMB3 read half).
 *
 * Sibling to `storage-roundtrip.e2e.integration.test.ts` (T2.8 storage
 * half). Reuses the same synthetic-EQL-bundle approach but extends the
 * stub with two function definitions — `eql_v2.eq(a, b)` and
 * `eql_v2.ilike(a, b)` — so the operator-lowering paths
 * (`cipherstashEq`, `cipherstashIlike` from M3 R1) reach a real
 * Postgres function call at execute time.
 *
 * Three search/decrypt phases land per the round prompt:
 *
 *   1. **Insert 10 envelopes** (carry-forward from T2.8). Asserts the
 *      bulk-encrypt middleware made exactly one `bulkEncrypt` call.
 *   2. **`cipherstashEq('alice5@example.com')`** returns the matching
 *      row; the lowered SQL goes through `eql_v2.eq(...)`.
 *   3. **`cipherstashIlike('%alice%')`** returns all 10 rows.
 *      `decryptAll` over the 10-row result set materializes plaintext
 *      and issues exactly one `bulkDecrypt` call (T3.6 — read half of
 *      AC-UMB3). Subsequent `envelope.decrypt()` returns the cached
 *      plaintext synchronously without consulting the SDK.
 *
 * **Synthetic EQL bundle** caveat — the stub is fake: `eql_v2.eq` and
 * `eql_v2.ilike` here compare the SDK`s synthetic ciphertexts as plain
 * strings (see {@link buildSyntheticEqlBundleSql}). The real EQL bundle
 * operates on encrypted ciphertexts via deterministic indexes attached
 * to the `unique` / `match` search-config rows. The synthetic
 * implementation exists so this test can exercise *test wiring* — the
 * operator-lowering → bulk-encrypt → driver.execute → codec.decode →
 * `decryptAll` → cached plaintext loop — against a real Postgres engine
 * (PGlite). It does NOT validate EQL`s correctness against real
 * encrypted ciphertexts; that gate belongs on a real-Postgres + real-
 * EQL-bundle e2e (out of project scope per the M3 R2 prompt`s explicit
 * "Items the orchestrator has triaged out of scope" list — M4 / post-
 * Project-1 territory).
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapterControl from '@prisma-next/adapter-postgres/control';
import postgresAdapterRuntime from '@prisma-next/adapter-postgres/runtime';
import { executePerSpaceDbApply } from '@prisma-next/cli/control-api';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import postgresDriverControl from '@prisma-next/driver-postgres/control';
import postgresDriverRuntime from '@prisma-next/driver-postgres/runtime';
import sqlFamilyDescriptor, {
  type ExtensionMigrationPackage,
  INIT_ADDITIVE_POLICY,
  type SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { writeExtensionMigrationPackage } from '@prisma-next/migration-tools/io';
import { emitPinnedSpaceArtefacts } from '@prisma-next/migration-tools/spaces';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  type AnyExpression,
  ColumnRef,
  InsertAst,
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

const APP_CONTRACT_HASH = coreHash('sha256:cipherstash-umbrella-app-v1');
const APP_PROFILE_HASH = profileHash('sha256:cipherstash-umbrella-app-profile-v1');
const APP_TABLE = 'User';
const APP_FIELD = 'email';
const ROW_COUNT = 10;

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
 * Synthetic EQL bundle with search-operator stubs.
 *
 * Mirrors the storage-roundtrip e2e`s baseline stub (composite type +
 * configuration table + add/remove search-config functions) and adds
 * two function stubs the M3 R1 operator lowering reaches at execute
 * time:
 *
 *   - `eql_v2.eq(a, b)` — boolean equality on the synthetic SDK`s
 *     `{ c: 'ct:<plaintext>' }` ciphertexts. Both `a` and `b` are
 *     `eql_v2_encrypted` composites whose `data` jsonb slot carries
 *     the SDK`s payload; the function compares the `c` keys directly.
 *   - `eql_v2.ilike(a, b)` — same shape as `eq` but uses Postgres
 *     `ILIKE` so the search pattern (`%alice%`) embedded inside the
 *     synthetic ciphertext (`ct:%alice%`) matches stored ciphertexts
 *     (`ct:alice0@example.com`, ...) under standard ILIKE semantics.
 *     The `%` wildcards live inside the synthetic ciphertext payload
 *     verbatim — the real EQL bundle keeps the wildcards encrypted at
 *     a different layer.
 *
 * **Both `eq` and `ilike` here are fake** — they cheat by comparing
 * cleartexts. Real EQL `eql_v2.eq` operates on the deterministic
 * `unique` index attached at search-config registration; real EQL
 * `eql_v2.ilike` operates on the bloom-filter `match` index. The
 * synthetic forms exist exclusively for test wiring; correctness of
 * EQL`s encrypted operators is an out-of-scope (M4+) concern.
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
    // Synthetic search-operator stubs — see this file`s top-level
    // docblock for why "fake EQL".
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
  const projectRoot = await mkdtemp(join(tmpdir(), 'cipherstash-umbrella-'));
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

function buildInsertPlan(rows: ReadonlyArray<{ id: string; email: EncryptedString }>) {
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
  readonly email: EncryptedString;
}

/**
 * Build a SELECT with a WHERE clause carrying the cipherstash operator
 * predicate. The operator`s impl is invoked exactly the way the ORM
 * model accessor would: with a column-accessor-shaped `self` whose
 * `buildAst()` returns the `ColumnRef`, and the user value as the
 * second argument. The returned `Expression` is unwrapped to the
 * underlying `OperationExpr` and embedded in the AST`s `where` slot.
 */
function buildSearchPlan(method: 'cipherstashEq' | 'cipherstashIlike', value: string) {
  const operators = cipherstashQueryOperations();
  const op = operators.find((o) => o.method === method);
  if (!op) {
    throw new Error(`cipherstash operator ${method} not found`);
  }
  const columnAccessor = {
    returnType: { codecId: CIPHERSTASH_STRING_CODEC_ID, nullable: false },
    buildAst: () => ColumnRef.of(APP_TABLE, APP_FIELD),
  };
  // `op.impl`'s declared return type is the framework`s narrow
  // `QueryOperationReturn`; the practical shape is `Expression<...>`
  // whose `buildAst()` yields an `AnyExpression`. Cast through
  // `unknown` (mirroring the model-accessor + operator-lowering test
  // helpers) to bridge the framework`s intentionally-narrow surface.
  const impl = op.impl as unknown as (...args: unknown[]) => { buildAst(): AnyExpression };
  const predicate = impl(columnAccessor, value).buildAst();
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
    where: predicate,
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

describe.sequential(
  'cipherstash full umbrella round-trip — search + decryptAll (PGlite, T3.5 + T3.6)',
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

    it('inserts → cipherstashEq → cipherstashIlike → decryptAll round-trips with one bulkEncrypt per write group and one bulkDecrypt per read group (AC-UMB1 search half + AC-UMB3 read half)', async () => {
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
        // ── Phase 1: insert 10 envelopes (carry-forward from T2.8) ──
        const plaintexts = Array.from({ length: ROW_COUNT }, (_, i) => `alice${i}@example.com`);
        const envelopes = plaintexts.map((p) => EncryptedString.from(p));
        const insertPlan = buildInsertPlan(
          envelopes.map((email, i) => ({ id: `user-${i}`, email })),
        );
        await runtime.execute(insertPlan).toArray();

        // AC-UMB3 storage half — exactly one bulk-encrypt per
        // `(table, column)` group regardless of row count.
        expect(sdk.bulkEncryptCalls).toHaveLength(1);
        expect(sdk.bulkEncryptCalls[0]?.routingKey).toEqual({
          table: APP_TABLE,
          column: APP_FIELD,
        });
        expect(sdk.bulkEncryptCalls[0]?.values).toHaveLength(ROW_COUNT);

        // ── Phase 2: cipherstashEq returns the matching row ──
        const eqPlan = buildSearchPlan('cipherstashEq', 'alice5@example.com');
        const eqResults = await runtime.execute(eqPlan).toArray();
        expect(eqResults).toHaveLength(1);
        expect(eqResults[0]?.id).toBe('user-5');
        expect(eqResults[0]?.email).toBeInstanceOf(EncryptedString);

        // The cipherstashEq operator wraps its argument in an
        // EncryptedString envelope and the bulk-encrypt middleware
        // therefore issues a second `bulkEncrypt` call (one envelope
        // = one batch under `(User, email)` routing key) before the
        // SELECT runs against the synthetic `eql_v2.eq` function.
        expect(sdk.bulkEncryptCalls).toHaveLength(2);

        // ── Phase 3: cipherstashIlike returns all 10 rows ──
        const ilikePlan = buildSearchPlan('cipherstashIlike', '%alice%');
        const ilikeResults = await runtime.execute(ilikePlan).toArray();
        expect(ilikeResults).toHaveLength(ROW_COUNT);
        for (const row of ilikeResults) {
          expect(row.email).toBeInstanceOf(EncryptedString);
        }
        // Search-arg encryption took a third bulk-encrypt round-trip.
        expect(sdk.bulkEncryptCalls).toHaveLength(3);

        // ── Phase 4: decryptAll over 10 rows = 1 bulkDecrypt call ──
        // (T3.6 — read half of AC-UMB3.) Pre-flight: nothing
        // decrypted yet on the read side, so every envelope`s
        // plaintext slot is empty and the SDK`s single-cell decrypt
        // counter is at zero.
        expect(sdk.bulkDecryptCalls).toHaveLength(0);
        expect(sdk.singleDecryptCalls).toHaveLength(0);

        await decryptAll(ilikeResults);

        expect(sdk.bulkDecryptCalls).toHaveLength(1);
        expect(sdk.bulkDecryptCalls[0]?.routingKey).toEqual({
          table: APP_TABLE,
          column: APP_FIELD,
        });
        expect(sdk.bulkDecryptCalls[0]?.ciphertexts).toHaveLength(ROW_COUNT);

        // AC-DEC3 / AC-ENV3 — every envelope`s `decrypt()` now
        // returns plaintext synchronously without an extra SDK call.
        const sortedById = [...ilikeResults].sort((a, b) => a.id.localeCompare(b.id));
        const decrypted = await Promise.all(sortedById.map((row) => row.email.decrypt()));
        expect(decrypted).toEqual(plaintexts);
        expect(sdk.singleDecryptCalls).toHaveLength(0);

        // ── Phase 5: decryptAll on already-decrypted rows is a no-op ──
        await decryptAll(ilikeResults);
        expect(sdk.bulkDecryptCalls).toHaveLength(1);
      } finally {
        await runtime.close();
      }
    });
  },
);
