/**
 * Integration tests for `operation-resolver.ts`.
 *
 * The descriptor pipeline (`planDescriptors` → `resolveOperations`) is otherwise
 * uncovered by integration tests — the legacy planner integration tests bypass
 * the resolver. Most resolve* functions are thin glue over already-tested helpers
 * (planner-ddl-builders, planner-sql-checks). These tests cover only the cases
 * with real branching logic:
 *
 *   - dataTransform: lowerSqlPlan integration, boolean sentinels, TODO guard
 *   - addColumn(overrides.nullable): NOT NULL backfill pattern
 *   - alterColumnType(using/toType): non-default cast / explicit type
 */

import postgresAdapterDescriptor from '@prisma-next/adapter-postgres/control';
import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import postgresDriverDescriptor from '@prisma-next/driver-postgres/control';
import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  DataTransformOperation,
  OperationDescriptor,
} from '@prisma-next/framework-components/control';
import type { SqlStorage, StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PostgresPlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import postgresTargetDescriptor from '../../src/exports/control';
import {
  addColumn,
  alterColumnType,
  dataTransform,
  TODO,
} from '../../src/exports/migration-builders';

type SqlOp = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

const testTimeout = timeouts.spinUpPpgDev;

const frameworkComponents = [
  postgresTargetDescriptor as TargetBoundComponentDescriptor<'sql', 'postgres'>,
  postgresAdapterDescriptor as TargetBoundComponentDescriptor<'sql', 'postgres'>,
];

type PostgresControlDriver = Awaited<ReturnType<typeof postgresDriverDescriptor.create>>;

async function resetDatabase(driver: PostgresControlDriver): Promise<void> {
  await driver.query('drop schema if exists public cascade');
  await driver.query('create schema public');
}

// ============================================================================
// Contract construction helpers (mirrored from descriptor-planner.scenarios.test.ts)
// ============================================================================

function col(
  nativeType: string,
  codecId: string,
  opts?: { nullable?: boolean; default?: StorageColumn['default']; typeRef?: string },
): StorageColumn {
  return {
    nativeType,
    codecId,
    nullable: opts?.nullable ?? false,
    ...(opts?.default !== undefined ? { default: opts.default } : {}),
    ...(opts?.typeRef !== undefined ? { typeRef: opts.typeRef } : {}),
  };
}

const textCol = (opts?: { nullable?: boolean }) => col('text', 'pg/text@1', opts);
const intCol = (opts?: { nullable?: boolean }) => col('int4', 'pg/int4@1', opts);
const uuidCol = (opts?: { nullable?: boolean }) => col('uuid', 'pg/uuid@1', opts);

function table(
  columns: Record<string, StorageColumn>,
  opts?: { primaryKey?: { columns: string[] } },
): StorageTable {
  return {
    columns,
    primaryKey: opts?.primaryKey ?? { columns: [Object.keys(columns)[0]!] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
}

function contract(tables: Record<string, StorageTable>): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage: {
      tables,
      storageHash: coreHash(`sha256:${JSON.stringify(tables)}`),
    },
    roots: {},
    models: {},
    capabilities: { sql: { selectRowsBetween: true } },
    extensionPacks: {},
    meta: {},
  };
}

function resolve(descriptors: OperationDescriptor[], toContract: Contract<SqlStorage>) {
  return postgresTargetDescriptor.migrations!.resolveDescriptors!(descriptors, {
    fromContract: null,
    toContract,
    frameworkComponents,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe.sequential('operation-resolver integration', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, testTimeout);

  beforeEach(async () => {
    driver = await postgresDriverDescriptor.create(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  });

  // --------------------------------------------------------------------------
  // dataTransform
  // --------------------------------------------------------------------------

  describe('dataTransform', () => {
    it(
      'lowers query-plan check + run via lowerSqlPlan and the produced SQL executes against PG',
      { timeout: testTimeout },
      async () => {
        // Setup: table with rows that need transforming
        await driver!.query(
          'create table "user" (id uuid primary key, score int not null default 0)',
        );
        await driver!.query(
          `insert into "user" (id, score) values ('11111111-1111-1111-1111-111111111111', 0), ('22222222-2222-2222-2222-222222222222', 0), ('33333333-3333-3333-3333-333333333333', 10)`,
        );

        const c = contract({ user: table({ id: uuidCol(), score: intCol() }) });

        // biome-ignore lint/suspicious/noExplicitAny: untyped where callback in test
        const zeroScore = (f: any, fns: any) => fns.eq(f.score, 0);

        const ops = resolve(
          [
            dataTransform('lift-zero-scores', {
              // biome-ignore lint/suspicious/noExplicitAny: untyped db in test callback
              check: (db: any) => db.user.select('id').where(zeroScore),
              // biome-ignore lint/suspicious/noExplicitAny: untyped db in test callback
              run: (db: any) => db.user.update({ score: 100 }).where(zeroScore),
            }),
          ],
          c,
        );

        expect(ops).toHaveLength(1);
        const dt = ops[0] as DataTransformOperation;
        expect(dt.operationClass).toBe('data');
        // check is a SerializedQueryPlan in this scenario, not boolean/null
        if (typeof dt.check !== 'object' || dt.check === null) {
          throw new Error('expected serialized check plan');
        }
        if (!dt.run) {
          throw new Error('expected resolved run plans');
        }
        expect(dt.check.sql).toMatch(/select/i);
        expect(dt.run).toHaveLength(1);
        expect(dt.run[0]!.sql).toMatch(/update/i);

        // Execute the produced SQL: precheck shows rows, run fills them, postcheck shows none
        const before = await driver!.query<{ id: string }>(dt.check.sql, [...dt.check.params]);
        expect(before.rows.length).toBe(2);

        await driver!.query(dt.run[0]!.sql, [...dt.run[0]!.params]);

        const after = await driver!.query<{ id: string }>(dt.check.sql, [...dt.check.params]);
        expect(after.rows.length).toBe(0);
      },
    );

    it('preserves the boolean `check: true` sentinel through the resolver', () => {
      const c = contract({ user: table({ id: uuidCol(), score: intCol() }) });

      const ops = resolve(
        [
          dataTransform('always-skip', {
            check: true,
            // biome-ignore lint/suspicious/noExplicitAny: untyped db in test callback
            run: (db: any) => db.user.update({ score: 0 }),
          }),
        ],
        c,
      );

      expect(ops).toHaveLength(1);
      const dt = ops[0] as DataTransformOperation;
      expect(dt.check).toBe(true);
      // Run is still resolved — runner uses check sentinel to decide whether to invoke it
      if (!dt.run) {
        throw new Error('expected resolved run plans');
      }
      expect(dt.run).toHaveLength(1);
      expect(dt.run[0]!.sql).toMatch(/update/i);
    });

    it('throws when a TODO sentinel reaches the resolver', () => {
      const c = contract({ user: table({ id: uuidCol(), score: intCol() }) });

      expect(() =>
        resolve(
          [
            dataTransform('unfilled', {
              check: TODO,
              run: TODO,
            }),
          ],
          c,
        ),
      ).toThrow(/unimplemented TODO placeholder/);
    });
  });

  // --------------------------------------------------------------------------
  // addColumn(overrides)
  // --------------------------------------------------------------------------

  describe('addColumn', () => {
    it(
      'overrides.nullable=true emits a nullable column even when the contract declares NOT NULL',
      { timeout: testTimeout },
      async () => {
        // Pre-create the table without the email column
        await driver!.query('create table "user" (id uuid primary key)');

        // Contract declares email as NOT NULL — but we override to nullable for backfill
        const c = contract({
          user: table({ id: uuidCol(), email: textCol({ nullable: false }) }),
        });

        const ops = resolve([addColumn('user', 'email', { nullable: true })], c);

        expect(ops).toHaveLength(1);
        const op = ops[0] as SqlOp;
        // execute SQL must NOT contain NOT NULL
        expect(op.execute[0]!.sql).not.toMatch(/not\s+null/i);
        expect(op.execute[0]!.sql).toMatch(/add column.*email/i);

        // Apply and verify column is nullable in PG
        await driver!.query(op.execute[0]!.sql);
        const result = await driver!.query<{ is_nullable: 'YES' | 'NO' }>(
          `select is_nullable from information_schema.columns where table_schema='public' and table_name='user' and column_name='email'`,
        );
        expect(result.rows[0]?.is_nullable).toBe('YES');
      },
    );
  });

  // --------------------------------------------------------------------------
  // alterColumnType(using/toType)
  // --------------------------------------------------------------------------

  describe('alterColumnType', () => {
    it('honors `using` expression for non-default casts', { timeout: testTimeout }, async () => {
      // Setup: column starts as text, contract declares int4
      await driver!.query('create table "user" (id uuid primary key, age text not null)');
      await driver!.query(
        `insert into "user" (id, age) values ('11111111-1111-1111-1111-111111111111', '42')`,
      );

      const c = contract({ user: table({ id: uuidCol(), age: intCol() }) });

      const ops = resolve([alterColumnType('user', 'age', { using: '(age::int4 + 0)' })], c);

      expect(ops).toHaveLength(1);
      const op = ops[0] as SqlOp;
      expect(op.execute[0]!.sql).toMatch(/USING \(age::int4 \+ 0\)/);
      // ensure it's the override, not the default `USING "age"::...` form
      expect(op.execute[0]!.sql).not.toMatch(/USING "age"::/);

      await driver!.query(op.execute[0]!.sql);
      const result = await driver!.query<{ data_type: string }>(
        `select data_type from information_schema.columns where table_schema='public' and table_name='user' and column_name='age'`,
      );
      expect(result.rows[0]?.data_type).toBe('integer');
    });

    it(
      'honors `toType` override (used by enum-rebuild recipe to switch to a temp type)',
      { timeout: testTimeout },
      async () => {
        await driver!.query('create table "user" (id uuid primary key, role text not null)');
        await driver!.query("create type \"user_role_temp\" as enum ('admin', 'user')");
        await driver!.query(
          `insert into "user" (id, role) values ('11111111-1111-1111-1111-111111111111', 'admin')`,
        );

        // Contract column type is irrelevant — toType drives the alter
        const c = contract({ user: table({ id: uuidCol(), role: textCol() }) });

        const ops = resolve(
          [
            alterColumnType('user', 'role', {
              toType: 'user_role_temp',
              using: 'role::user_role_temp',
            }),
          ],
          c,
        );

        expect(ops).toHaveLength(1);
        const op = ops[0] as SqlOp;
        // execute SQL must alter to the toType, not the contract-derived text
        expect(op.execute[0]!.sql).toMatch(/TYPE\s+"public"\."user_role_temp"/);
        expect(op.execute[0]!.sql).not.toMatch(/TYPE\s+text/i);

        await driver!.query(op.execute[0]!.sql);
        const result = await driver!.query<{ udt_name: string }>(
          `select udt_name from information_schema.columns where table_schema='public' and table_name='user' and column_name='role'`,
        );
        expect(result.rows[0]?.udt_name).toBe('user_role_temp');
      },
    );
  });
});
