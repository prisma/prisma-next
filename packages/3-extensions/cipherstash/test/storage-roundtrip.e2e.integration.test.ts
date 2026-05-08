/**
 * Storage round-trip end-to-end against PGlite — cipherstash plan.md
 * § T2.8 (storage half of AC-UMB1 + AC-UMB3).
 *
 * Builds on `scenario-a.e2e.integration.test.ts` (which proves the
 * control-plane apply path: bundle install + codec-hook ops landing
 * in `eql_v2_configuration`) and exercises the runtime-plane round
 * trip:
 *
 *   1. Provision the database via `executePerSpaceDbApply` with the
 *      synthetic EQL bundle (PGlite-compatible stub — see
 *      {@link buildSyntheticEqlBundleSql}). This creates the
 *      `eql_v2_encrypted` composite type, the `User` table with an
 *      encrypted `email` column, and the `add_search_config` row in
 *      `eql_v2_configuration`.
 *
 *   2. Stand up a runtime via `createRuntime` with:
 *        - postgres target / adapter / driver (runtime planes)
 *        - `createCipherstashRuntimeDescriptor({ sdk })` as an
 *          extension pack (F5 — runtime descriptor wrapper)
 *        - `bulkEncryptMiddleware(sdk)` registered manually (the SQL
 *          runtime descriptor has no middleware slot; consumers
 *          compose it themselves — documented on the
 *          `./middleware` export)
 *      bound to the same in-memory `CipherstashSdk` mock.
 *
 *   3. Insert 10 rows × 1 cipherstash column via a hand-built
 *      `InsertAst` wrapped in `planFromAst`. Assert the bulk-encrypt
 *      middleware made **exactly one** `bulkEncrypt` call (AC-MW1
 *      bulk-amortization claim, AC-UMB3 storage half), batching all
 *      10 plaintexts under one `(table, column)` routing key.
 *
 *   4. Query the rows back via a hand-built `SelectAst`. Assert each
 *      decoded row's `email` is an `EncryptedString` envelope; calling
 *      `envelope.decrypt()` issues the SDK's single-cell `decrypt` and
 *      returns the original plaintext (closing the read half of the
 *      storage round-trip).
 *
 * Why hand-built AST and not `db.insert(User, ...)` from
 * `@prisma-next/sql-orm-client`? The cipherstash package does not yet
 * carry an ORM-client devDependency and the higher-level surface adds
 * lane / DSL machinery the storage round-trip does not exercise.
 * Going through `runtime.execute(planFromAst(ast, contract))` exercises
 * exactly the runtime path the spec calls out — middleware →
 * codec.encode → driver.execute → codec.decode.
 *
 * **PGlite limits**. Same scope as `scenario-a`: PGlite ships no
 * `pgcrypto`, so the synthetic bundle stubs the EQL functions the
 * codec hook touches. The storage half of the round-trip — type cast
 * `$N::eql_v2_encrypted`, composite-text encode/decode, marker rows —
 * runs against real Postgres semantics. Operator lowering (`eq`,
 * `ilike`) and the real-bundle e2e against `pgcrypto` are M3 scope.
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
import {
  CIPHERSTASH_INVARIANTS,
  CIPHERSTASH_SPACE_ID,
  CIPHERSTASH_STRING_CODEC_ID,
  EQL_V2_CONFIGURATION_TABLE,
  EQL_V2_ENCRYPTED_TYPE,
  EQL_V2_SCHEMA,
} from '../src/core/constants';
import { cipherstashContract } from '../src/core/contract';
import { cipherstashBaselineMigration, cipherstashHeadRef } from '../src/core/migrations';
import cipherstashExtensionDescriptor from '../src/exports/control';
import { bulkEncryptMiddleware } from '../src/exports/middleware';
import type {
  CipherstashBulkDecryptArgs,
  CipherstashBulkEncryptArgs,
  CipherstashSdk,
  CipherstashSingleDecryptArgs,
} from '../src/exports/runtime';
import {
  CIPHERSTASH_EXTENSION_VERSION,
  createCipherstashRuntimeDescriptor,
  EncryptedString,
} from '../src/exports/runtime';

const APP_CONTRACT_HASH = coreHash('sha256:cipherstash-roundtrip-app-v1');
const APP_PROFILE_HASH = profileHash('sha256:cipherstash-roundtrip-app-profile-v1');
const APP_TABLE = 'User';
const APP_FIELD = 'email';

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
            // Both flags are required by `encryptedStringParamsSchema`;
            // only `equality: true` triggers the codec hook's
            // `add_search_config:unique@v1` op (the storage round-trip
            // itself is search-mode-independent).
            typeParams: { equality: true, freeTextSearch: false },
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
 * Synthetic EQL bundle stub. Mirrors `scenario-a.e2e.integration.test.ts`
 * — see that file's block comment for why the real bundle can't run on
 * PGlite (`pgcrypto` extension absent).
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

/**
 * Deterministic in-memory SDK. `bulkEncrypt` returns
 * `{ c: 'ct:' + plaintext, t: <table>, col: <column> }` per item — JSON-
 * encodable so the codec's `encodeEqlV2EncryptedWire` happily JSON-
 * stringifies it for the composite-text wire format. `decrypt` (single-
 * cell) reverses the mapping by reading the `c` slot.
 *
 * Counters back the bulk-amortization assertion (one `bulkEncrypt` call
 * per 10-row insert).
 */
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
  const projectRoot = await mkdtemp(join(tmpdir(), 'cipherstash-storage-'));
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

function buildSelectPlan() {
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
    where: undefined,
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
  'cipherstash storage round-trip (PGlite, T2.8)',
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
        // @prisma/dev rejects concurrent connections — close the control
        // driver so the runtime's pool can take its turn on the same
        // PGlite instance for the round-trip phase of the test.
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

    it('inserts 10 envelopes with one bulkEncrypt call and round-trips back to plaintext via decrypt()', async () => {
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
        const envelopes = Array.from({ length: 10 }, (_, i) =>
          EncryptedString.from(`alice${i}@example.com`),
        );
        const insertPlan = buildInsertPlan(
          envelopes.map((email, i) => ({ id: `user-${i}`, email })),
        );

        await runtime.execute(insertPlan).toArray();

        // AC-MW1 / AC-UMB3 storage half — exactly one bulk-encrypt call
        // amortizes the 10-row insert.
        expect(sdk.bulkEncryptCalls).toHaveLength(1);
        expect(sdk.bulkEncryptCalls[0]?.routingKey).toEqual({
          table: APP_TABLE,
          column: APP_FIELD,
        });
        expect(sdk.bulkEncryptCalls[0]?.values).toEqual(
          envelopes.map((_, i) => `alice${i}@example.com`),
        );

        // Sanity-check the persisted shape directly via the runtime
        // driver's raw `query` (bypassing the codec round-trip): 10
        // rows, each carrying a non-null `email` jsonb payload whose
        // `.c` slot starts with `ct:` (the synthetic SDK's ciphertext
        // marker). The runtime driver is the only thing connected to
        // the @prisma/dev instance at this point — see beforeEach.
        const persisted = await driver.query<{ id: string; payload: string }>(
          `select "id", ("${APP_FIELD}").data::text as payload
           from public."${APP_TABLE}" order by "id" asc`,
        );
        expect(persisted.rows).toHaveLength(10);
        for (let i = 0; i < persisted.rows.length; i++) {
          const row = persisted.rows[i];
          expect(row?.id).toBe(`user-${i}`);
          expect(row?.payload).toContain(`"c": "ct:alice${i}@example.com"`);
        }

        // Read path: a hand-built SELECT exercises the codec.decode
        // round-trip; each cell decodes into a fresh `EncryptedString`
        // envelope carrying the SDK reference, so `decrypt()` issues
        // the SDK's single-cell decrypt and recovers the plaintext.
        const selected = await runtime.execute(buildSelectPlan()).toArray();
        expect(selected).toHaveLength(10);
        // Plain decode shape — every row has an EncryptedString
        // envelope on `email`, plus the original id.
        const sortedById = [...selected].sort((a, b) => a.id.localeCompare(b.id));
        for (let i = 0; i < sortedById.length; i++) {
          const row = sortedById[i];
          expect(row?.id).toBe(`user-${i}`);
          expect(row?.email).toBeInstanceOf(EncryptedString);
        }

        const decrypted = await Promise.all(sortedById.map((row) => row?.email.decrypt()));
        expect(decrypted).toEqual(envelopes.map((_, i) => `alice${i}@example.com`));

        // 10 single-cell decrypt calls — the read-side bulk path
        // (`decryptAll`) is M3 scope; M2 only guarantees the per-cell
        // envelope path round-trips.
        expect(sdk.singleDecryptCalls).toHaveLength(10);
      } finally {
        await runtime.close();
      }

      // Pin the descriptor's metadata so a future bump bumps both the
      // wrapper's version and the AC-CODEC5 evidence cell together.
      expect(CIPHERSTASH_EXTENSION_VERSION).toBe('0.0.1');
    });
  },
);
