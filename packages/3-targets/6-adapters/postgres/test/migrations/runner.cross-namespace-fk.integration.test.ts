import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import {
  INIT_ADDITIVE_POLICY,
  type SqlMigrationPlanOperationStep,
} from '@prisma-next/family-sql/control';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage } from '@prisma-next/sql-contract/types';
import { PostgresSchema, postgresCreateNamespace } from '@prisma-next/target-postgres/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  testTimeout,
} from './fixtures/runner-fixtures';

/**
 * AC4 — cross-namespace foreign keys on Postgres end-to-end (FL-02).
 *
 * Authoring a single contract with two named namespaces (`auth` +
 * `public`) and a foreign key `public.profile.user_id -> auth."user"(id)`
 * must produce DDL that:
 *
 *   - creates `auth."user"` and `public."profile"` in their respective
 *     schemas, and
 *   - renders `REFERENCES "auth"."user" ("id")` (schema-qualified
 *     through the target namespace's `qualifyTable` concretion, not the
 *     source's).
 *
 * The end-to-end runtime check applies that DDL via PGlite and
 * confirms the cross-schema FK is enforced by the database:
 * orphan inserts are rejected, parent-first inserts succeed.
 *
 * Mirrors the FL-02 acceptance scenario: a Supabase-style `auth.users`
 * referenced from an app-owned `public.profiles` table. Schemas are
 * pre-created in `beforeAll` since the planner has no contract-level
 * `CREATE SCHEMA` op for named schemas today (operator-supplied, the
 * same convention `runner.unbound-namespace.integration.test.ts` uses
 * for tenant schemas).
 */

const AUTH_SCHEMA = 'auth';
const APP_SCHEMA = 'public';

function buildCrossNamespaceContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:cross-namespace-fk'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:cross-namespace-fk'),
      tables: {
        [AUTH_SCHEMA]: {
          user: {
            namespaceId: AUTH_SCHEMA,
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
        [APP_SCHEMA]: {
          profile: {
            namespaceId: APP_SCHEMA,
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              user_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              handle: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                source: { columns: ['user_id'] },
                target: { namespaceId: AUTH_SCHEMA, table: 'user', columns: ['id'] },
                name: 'profile_user_id_fkey',
                constraint: true,
                index: true,
              },
            ],
          },
        },
      },
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: PostgresSchema.unbound,
        [AUTH_SCHEMA]: postgresCreateNamespace(AUTH_SCHEMA),
        [APP_SCHEMA]: postgresCreateNamespace(APP_SCHEMA),
      },
    }),
    roots: {},
    models: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function flattenSql(steps: readonly SqlMigrationPlanOperationStep[]): readonly string[] {
  return steps.map((step) => step.sql);
}

async function executeStepsAgainst(
  driver: PostgresControlDriver,
  steps: readonly SqlMigrationPlanOperationStep[],
): Promise<void> {
  for (const step of steps) {
    await driver.query(step.sql, step.params ?? []);
  }
}

describe.sequential('AC4 — cross-namespace FK references end-to-end (FL-02)', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver;

  beforeAll(async () => {
    database = await createTestDatabase();
    driver = await createDriver(database.connectionString);

    // Named schemas are operator-supplied: the planner does not emit a
    // CREATE SCHEMA op for named-schema namespaces today. `public` is
    // created by Postgres by default; `auth` is created here so the
    // applied DDL can land its tables.
    await driver.query(`create schema if not exists ${AUTH_SCHEMA}`);
  }, testTimeout);

  afterAll(async () => {
    if (driver) await driver.close();
    if (database) await database.close();
  }, testTimeout);

  it(
    'plans qualified DDL for cross-namespace FK, applies it via PGlite, and enforces the FK across schemas',
    async () => {
      const contract = buildCrossNamespaceContract();
      const planner = postgresTargetDescriptor.createPlanner(familyInstance);
      const planResult = planner.plan({
        contract,
        schema: emptySchema,
        policy: INIT_ADDITIVE_POLICY,
        fromContract: null,
        frameworkComponents,
        spaceId: APP_SPACE_ID,
      });
      if (planResult.kind !== 'success') {
        throw new Error(`planner failed: ${JSON.stringify(planResult)}`);
      }

      const allSteps = planResult.plan.operations.flatMap((op) => [
        ...flattenSql(op.precheck),
        ...flattenSql(op.execute),
        ...flattenSql(op.postcheck),
      ]);
      const allSql = allSteps.join('\n');

      // Source-table CREATE statements land in their respective schemas.
      expect(allSql).toMatch(/CREATE TABLE\s+"auth"\."user"/);
      expect(allSql).toMatch(/CREATE TABLE\s+"public"\."profile"/);

      // The FK constraint qualifies the target through the auth schema —
      // the FR16b cross-namespace REFERENCES rendering.
      expect(allSql).toMatch(/REFERENCES\s+"auth"\."user"\s*\("id"\)/);
      // And not the source schema: the target namespace concretion wins.
      expect(allSql).not.toMatch(/REFERENCES\s+"public"\."user"/);

      const executeSteps = planResult.plan.operations.flatMap((op) => op.execute);
      await executeStepsAgainst(driver, executeSteps);

      // Catalog-level confirmation: tables landed in the right schemas.
      const physicalTables = await driver.query<{ table_schema: string; table_name: string }>(
        `select table_schema, table_name
         from information_schema.tables
         where (table_schema = 'auth' and table_name = 'user')
            or (table_schema = 'public' and table_name = 'profile')
         order by table_schema, table_name`,
      );
      expect(physicalTables.rows).toEqual([
        { table_schema: 'auth', table_name: 'user' },
        { table_schema: 'public', table_name: 'profile' },
      ]);

      // The FK constraint exists and points at the auth schema's user table.
      const fkRows = await driver.query<{
        constraint_name: string;
        source_schema: string;
        source_table: string;
        target_schema: string;
        target_table: string;
      }>(
        `select
           tc.constraint_name,
           tc.table_schema as source_schema,
           tc.table_name as source_table,
           ref_ns.nspname as target_schema,
           ref_cl.relname as target_table
         from information_schema.table_constraints tc
         join pg_catalog.pg_constraint pgc on pgc.conname = tc.constraint_name
         join pg_catalog.pg_class ref_cl on ref_cl.oid = pgc.confrelid
         join pg_catalog.pg_namespace ref_ns on ref_ns.oid = ref_cl.relnamespace
         where tc.constraint_type = 'FOREIGN KEY'
           and tc.table_schema = 'public'
           and tc.table_name = 'profile'`,
      );
      expect(fkRows.rows).toEqual([
        {
          constraint_name: 'profile_user_id_fkey',
          source_schema: 'public',
          source_table: 'profile',
          target_schema: 'auth',
          target_table: 'user',
        },
      ]);

      // FK enforcement: orphan inserts are rejected.
      await expect(
        driver.query(
          `insert into "public"."profile" ("id", "user_id", "handle") values (1, 999, $1)`,
          ['orphan'],
        ),
      ).rejects.toThrow();

      // Parent-first inserts succeed across schemas.
      await driver.query(`insert into "auth"."user" ("id", "email") values (1, $1)`, [
        'alice@example.com',
      ]);
      await driver.query(
        `insert into "public"."profile" ("id", "user_id", "handle") values (1, 1, $1)`,
        ['alice'],
      );

      const profileRows = await driver.query<{ id: number; user_id: number; handle: string }>(
        `select id, user_id, handle from "public"."profile" order by id`,
      );
      expect(profileRows.rows).toEqual([{ id: 1, user_id: 1, handle: 'alice' }]);
    },
    testTimeout,
  );
});
