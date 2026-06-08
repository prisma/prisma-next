import type { Contract } from '@prisma-next/contract/types';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import sqlFamilyPack from '@prisma-next/family-sql/pack';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  buildBoundContract,
  enumType,
  member,
} from '@prisma-next/sql-contract-ts/contract-builder';
import {
  ColumnRef,
  IdentifierRef,
  OrderByItem,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import postgresPack from '@prisma-next/target-postgres/pack';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../../src/core/adapter';
import type { PostgresContract } from '../../src/core/types';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
} from './fixtures/runner-fixtures';

const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' };

// Declaration order: low → high → medium. Lexical order would be high, low, medium.
const Priority = enumType(
  'Priority',
  pgText,
  member('Low', 'low'),
  member('High', 'high'),
  member('Medium', 'medium'),
);

function makeTaskContract(): PostgresContract {
  return buildBoundContract(
    sqlFamilyPack,
    postgresPack,
    { enums: { Priority } },
    ({ field: f, model: m }) => ({
      models: {
        Task: m('Task', {
          fields: {
            id: f.text().id(),
            priority: f.namedType(Priority).optional(),
          },
        }),
      },
    }),
  ) as Contract<SqlStorage> as PostgresContract;
}

async function migrate(driver: PostgresControlDriver, contract: PostgresContract): Promise<void> {
  const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
  const runner = postgresTargetDescriptor.createRunner(familyInstance);
  const result = planner.plan({
    contract,
    schema: emptySchema,
    policy: INIT_ADDITIVE_POLICY,
    fromContract: null,
    frameworkComponents,
    spaceId: APP_SPACE_ID,
  });
  if (result.kind !== 'success') {
    throw new Error(`Planner failed: ${JSON.stringify(result, null, 2)}`);
  }
  const executeResult = await runner.execute({
    driver,
    perSpaceOptions: [
      {
        space: result.plan.spaceId ?? APP_SPACE_ID,
        plan: result.plan,
        migrationEdges: synthEdges(result.plan),
        driver,
        destinationContract: contract,
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents,
      },
    ],
  });
  if (!executeResult.ok) {
    throw new Error(`Runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
  }
}

describe.sequential('ORDER BY on an enum column — declaration order, PGlite', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  });

  it('renders array_position over the value-set and sorts by declaration order', {
    timeout: testTimeout,
  }, async () => {
    const contract = makeTaskContract();
    await migrate(driver!, contract);

    // Insert rows out of declaration order.
    await driver!.query(`INSERT INTO "Task" (id, priority) VALUES
      ('a', 'high'), ('b', 'low'), ('c', 'medium'), ('d', 'low')`);

    const ast = SelectAst.from(TableSource.named('Task', undefined, 'public'))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('Task', 'id')),
        ProjectionItem.of('priority', ColumnRef.of('Task', 'priority')),
      ])
      .withOrderBy([
        OrderByItem.asc(ColumnRef.of('Task', 'priority')),
        OrderByItem.asc(ColumnRef.of('Task', 'id')),
      ]);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    expect(lowered.sql).toContain(
      `array_position(ARRAY['low', 'high', 'medium']::text[], "Task"."priority")`,
    );

    const rows = await driver!.query<{ id: string; priority: string }>(lowered.sql);
    expect(rows.rows.map((r) => r.priority)).toEqual(['low', 'low', 'high', 'medium']);
    expect(rows.rows.map((r) => r.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('intercepts an unqualified identifier-ref order column (sql-builder .orderBy form)', {
    timeout: testTimeout,
  }, async () => {
    const contract = makeTaskContract();
    await migrate(driver!, contract);

    await driver!.query(`INSERT INTO "Task" (id, priority) VALUES
      ('a', 'high'), ('b', 'low'), ('c', 'medium'), ('d', 'low')`);

    const ast = SelectAst.from(TableSource.named('Task', undefined, 'public'))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('Task', 'id')),
        ProjectionItem.of('priority', ColumnRef.of('Task', 'priority')),
      ])
      .withOrderBy([
        OrderByItem.asc(IdentifierRef.of('priority')),
        OrderByItem.asc(IdentifierRef.of('id')),
      ]);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    expect(lowered.sql).toContain(
      `array_position(ARRAY['low', 'high', 'medium']::text[], "priority")`,
    );

    const rows = await driver!.query<{ id: string; priority: string }>(lowered.sql);
    expect(rows.rows.map((r) => r.priority)).toEqual(['low', 'low', 'high', 'medium']);
    expect(rows.rows.map((r) => r.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('sorts NULLs last (ASC) alongside declaration-ordered non-null values', {
    timeout: testTimeout,
  }, async () => {
    const contract = makeTaskContract();
    await migrate(driver!, contract);

    await driver!.query(`INSERT INTO "Task" (id, priority) VALUES
      ('a', 'high'), ('b', NULL), ('c', 'low')`);

    const ast = SelectAst.from(TableSource.named('Task', undefined, 'public'))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('Task', 'id')),
        ProjectionItem.of('priority', ColumnRef.of('Task', 'priority')),
      ])
      .withOrderBy([OrderByItem.asc(ColumnRef.of('Task', 'priority'))]);

    const lowered = createPostgresAdapter().lower(ast, { contract });
    const rows = await driver!.query<{ id: string; priority: string | null }>(lowered.sql);

    // array_position returns NULL for the NULL row; ASC sorts NULLs last by default.
    expect(rows.rows.map((r) => r.priority)).toEqual(['low', 'high', null]);
    expect(rows.rows.map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });
});
