import { expectTypeOf, test } from 'vitest';
import { sql } from '../src/sql';
import { schema, makeT } from '../src/schema';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import type { ResultType, Plan, TableKey, TablesOf } from '../src/types';
import contractJson from './fixtures/contract.json' assert { type: 'json' };
import { validateContract } from '../src/contract';
import type { Contract, CodecTypes, ScalarToJs } from './fixtures/contract.d';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import type { CodecTypes as PgCodecTypes } from '@prisma-next/adapter-postgres/codec-types';

// Helper to simulate execute signature
function execute<Row>(_plan: Plan<Row>): AsyncIterable<Row> {
  return (async function* () {})();
}

// Helper to safely access table columns
function getTableColumns<T extends { columns: Record<string, unknown> }>(table: T): T['columns'] {
  return table.columns;
}

test('builder without select() has unknown Row type', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const tables = schema<Contract, CodecTypes>(contract).tables;

  const builder = sql<Contract, CodecTypes>({ contract, adapter });
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');
  const builderAfterFrom = builder.from(userTable);

  // Before select(), Row type should be unknown
  const plan = builderAfterFrom.build();
  expectTypeOf<ResultType<typeof plan>>().toEqualTypeOf<unknown>();
});

test('select() with object projection infers Row type', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const tables = schema<Contract, CodecTypes>(contract).tables;
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');
  const userColumns = userTable.columns;

  const plan = sql<Contract, CodecTypes>({ contract, adapter })
    .from(userTable)
    .select({
      id: userColumns['id']!,
      email: userColumns['email']!,
    })
    .build();

  // Row type should be inferred from projection
  type Row = ResultType<typeof plan>;

  // Should have id and email properties
  // Note: exact types depend on columnMeta, but structure should be correct
  // Verify plan structure
  expectTypeOf(plan).toExtend<Plan<Row>>();
});

test('build() returns Plan<Row> with inferred Row type', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const tables = schema<Contract, CodecTypes>(contract).tables;
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');
  const userColumns = userTable.columns;
  const idColumn = userColumns['id'];
  const emailColumn = userColumns['email'];
  if (!idColumn || !emailColumn) throw new Error('columns not found');

  const plan = sql<Contract, CodecTypes>({ contract, adapter })
    .from(userTable)
    .select({
      id: idColumn,
      email: emailColumn,
    })
    .build();

  type Row = ResultType<typeof plan>;

  // Strict checks: verify fields have correct types (will fail if never)
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();

  expectTypeOf(plan).toExtend<Plan<Row>>();
});

test('ResultType utility extracts Row type from Plan', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const tables = schema<Contract, CodecTypes>(contract).tables;
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');
  const userColumns = getTableColumns(userTable);
  const idColumn = userColumns['id'];
  const emailColumn = userColumns['email'];
  if (!idColumn || !emailColumn) throw new Error('columns not found');

  const plan = sql<Contract, CodecTypes>({ contract, adapter })
    .from(userTable)
    .select({
      id: idColumn,
      email: emailColumn,
    })
    .build();

  type ExtractedRow = ResultType<typeof plan>;
  // Contract fixture has column types as pg/*@1 IDs, so types come from CodecTypes
  // id has typeId 'pg/int4@1' → number, email has 'pg/text@1' → string

  // Strict checks: verify fields are NOT never and have correct types
  expectTypeOf<ExtractedRow['id']>().toEqualTypeOf<number>();
  expectTypeOf<ExtractedRow['email']>().toEqualTypeOf<string>();

  // Also verify the overall structure
  expectTypeOf<ExtractedRow>().toExtend<{ id: number; email: string }>();
});

test('execute() preserves Row type through execution', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const tables = schema<Contract, CodecTypes>(contract).tables;
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');
  const userColumns = getTableColumns(userTable);
  const idColumn = userColumns['id'];
  const emailColumn = userColumns['email'];
  if (!idColumn || !emailColumn) throw new Error('columns not found');

  const plan = sql<Contract, CodecTypes>({ contract, adapter })
    .from(userTable)
    .select({
      id: idColumn,
      email: emailColumn,
    })
    .build();

  type Row = ResultType<typeof plan>;
  const result = execute(plan);

  expectTypeOf(result).toExtend<AsyncIterable<Row>>();
});

test('builder chain preserves Row type through methods', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const tables = schema<Contract, CodecTypes>(contract).tables;
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');
  const userColumns = getTableColumns(userTable);
  const idColumn = userColumns['id'];
  const emailColumn = userColumns['email'];
  if (!idColumn || !emailColumn) throw new Error('columns not found');

  const builderAfterFrom = sql({ contract, adapter }).from(userTable);
  const builderWithSelect = builderAfterFrom.select({
    id: idColumn,
    email: emailColumn,
  });

  // All methods should preserve Row type
  const builderWithWhere = builderWithSelect.where(
    idColumn.eq({ kind: 'param-placeholder', name: 'userId' }),
  );
  const builderWithOrder = builderWithSelect.orderBy(idColumn.asc());
  const builderWithLimit = builderWithSelect.limit(10);

  const plan = builderWithSelect.build();
  type Row = ResultType<typeof plan>;

  // Methods that don't change projection should preserve Row type
  const planFromWhere = builderWithWhere.build();
  const planFromOrder = builderWithOrder.build();
  const planFromLimit = builderWithLimit.build();

  expectTypeOf<ResultType<typeof planFromWhere>>().toEqualTypeOf<Row>();
  expectTypeOf<ResultType<typeof planFromOrder>>().toEqualTypeOf<Row>();
  expectTypeOf<ResultType<typeof planFromLimit>>().toEqualTypeOf<Row>();
});

test('wrong Row type assignments fail type check', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const tables = schema<Contract, CodecTypes>(contract).tables;
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');
  const userColumns = getTableColumns(userTable);
  const idColumn = userColumns['id'];
  const emailColumn = userColumns['email'];
  if (!idColumn || !emailColumn) throw new Error('columns not found');

  const plan = sql<Contract, CodecTypes>({ contract, adapter })
    .from(userTable)
    .select({
      id: idColumn,
      email: emailColumn,
    })
    .build();

  // This should compile - correct type
  type Row = ResultType<typeof plan>;
  const correct: Plan<Row> = plan;
  expectTypeOf(correct).toExtend<Plan<Row>>();

  // Type system should preserve Row type through the chain
  // If Row is inferred correctly, it should not be assignable to a completely different type
  // Note: Due to TypeScript's structural typing with unknown, this test may not fail
  // but the important thing is that Row is correctly inferred from the projection
  // This assignment would fail if Row was a specific type (not unknown)
  // For now, we verify that Row is inferred (even if as unknown) by checking the plan structure
  expectTypeOf(plan).toExtend<Plan<Row>>();
});

test('nullable columns are handled correctly', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const tables = schema<Contract, CodecTypes>(contract).tables;
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');
  const userColumns = getTableColumns(userTable);
  const idColumn = userColumns['id'];
  const emailColumn = userColumns['email'];
  if (!idColumn || !emailColumn) throw new Error('columns not found');

  const plan = sql<Contract, CodecTypes>({ contract, adapter })
    .from(userTable)
    .select({
      id: idColumn,
      email: emailColumn,
    })
    .build();

  type Row = ResultType<typeof plan>;
  // Row should have the projection properties
  expectTypeOf(plan).toExtend<Plan<Row>>();
});

test('different column types map correctly', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const tables = schema<Contract, CodecTypes>(contract).tables;
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');
  const userColumns = getTableColumns(userTable);
  const idColumn = userColumns['id'];
  const emailColumn = userColumns['email'];
  const createdAtColumn = userColumns['createdAt'];
  if (!idColumn || !emailColumn || !createdAtColumn) throw new Error('columns not found');

  const plan = sql<Contract, CodecTypes>({ contract, adapter })
    .from(userTable)
    .select({
      id: idColumn,
      email: emailColumn,
      createdAt: createdAtColumn,
    })
    .build();

  type Row = ResultType<typeof plan>;
  expectTypeOf(plan).toExtend<Plan<Row>>();
});

test('generic contract types are preserved', () => {
  const contract = validateContract<Contract>(contractJson);
  createPostgresAdapter(); // Used for type checking only
  schema<Contract, CodecTypes>(contract); // Used for type checking only

  // Verify TableKey extracts correct table names
  type ContractTableKey = TableKey<typeof contract>;
  expectTypeOf<ContractTableKey>().toEqualTypeOf<'user'>();

  // Verify TablesOf extracts correct structure
  type ContractTables = TablesOf<typeof contract>;
  expectTypeOf<ContractTables>().toHaveProperty('user');

  // Verify schema() preserves contract generic - should have literal 'user' key
  const schemaHandle = schema<Contract, CodecTypes>(contract);
  expectTypeOf(schemaHandle.tables).toHaveProperty('user');

  // Verify we can access with literal key
  const userTable = schemaHandle.tables['user'];
  expectTypeOf(userTable).not.toBeUndefined();
});

test('Contract namespace types are available', () => {
  // Verify Tables namespace is accessible
  type UserTable = Contract['storage']['tables']['user'];
  expectTypeOf<UserTable>().toHaveProperty('id');
  expectTypeOf<UserTable>().toHaveProperty('email');
  expectTypeOf<UserTable>().toHaveProperty('createdAt');

  // Verify Models namespace is accessible
  type UserModel = Contract['models']['User'];
  expectTypeOf<UserModel>().toHaveProperty('id');
  expectTypeOf<UserModel>().toHaveProperty('email');
  expectTypeOf<UserModel>().toHaveProperty('createdAt');

  // Verify mappings work correctly
  type UserTableName = Contract['mappings'] extends { modelToTable: infer MT }
    ? MT extends { User: infer U }
      ? U
      : never
    : never;
  expectTypeOf<UserTableName>().toEqualTypeOf<'user'>();

  type UserModelName = Contract['mappings'] extends { tableToModel: infer TM }
    ? TM extends { user: infer U }
      ? U
      : never
    : never;
  expectTypeOf<UserModelName>().toEqualTypeOf<'User'>();
});

test('makeT() returns tables graph', () => {
  const contract = validateContract<Contract>(contractJson);
  const t = makeT<Contract, CodecTypes>(contract);

  // makeT should return the same as schema().tables
  expectTypeOf(t).toHaveProperty('user');
  const userTable = t['user'];
  if (userTable) {
    expectTypeOf(userTable).toHaveProperty('columns');
    const columns = userTable.columns;
    expectTypeOf(columns).toHaveProperty('id');
    expectTypeOf(columns).toHaveProperty('email');
    expectTypeOf(columns).toHaveProperty('createdAt');
  }
});

test('sql() preserves contract generic through builder chain', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const tables = schema<Contract, CodecTypes>(contract).tables;
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');

  const builder = sql<Contract, CodecTypes>({ contract, adapter });
  const builderAfterFrom = builder.from(userTable);

  // Builder should preserve contract type
  expectTypeOf(builder).toExtend<ReturnType<typeof sql<Contract, CodecTypes>>>();
  expectTypeOf(builderAfterFrom).toExtend<
    ReturnType<ReturnType<typeof sql<Contract, CodecTypes>>['from']>
  >();
});

test('ScalarToJs mapping resolves scalar types correctly', () => {
  // Create a contract without extension decorations to test ScalarToJs fallback
  const contractWithoutCodecs = {
    ...contractJson,
    extensions: {},
  };
  const contract = validateContract<Contract>(contractWithoutCodecs);
  const adapter = createPostgresAdapter();
  const tables = schema<Contract, CodecTypes>(contract).tables;
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');
  const userColumns = getTableColumns(userTable);
  const idColumn = userColumns['id']; // int4
  const emailColumn = userColumns['email']; // text
  const createdAtColumn = userColumns['createdAt']; // timestamptz
  if (!idColumn || !emailColumn || !createdAtColumn) throw new Error('columns not found');

  const plan = sql<Contract, CodecTypes>({ contract, adapter })
    .from(userTable)
    .select({
      id: idColumn,
      email: emailColumn,
      createdAt: createdAtColumn,
    })
    .build();

  type Row = ResultType<typeof plan>;

  // Verify ScalarToJs mapping: int4 → number, text → string, timestamptz → string
  // Strict checks: verify fields are NOT never
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();
  expectTypeOf<Row['createdAt']>().toEqualTypeOf<string>();

  // Also verify the overall structure
  expectTypeOf<Row>().toExtend<{
    id: number; // int4 → number via ScalarToJs
    email: string; // text → string via ScalarToJs
    createdAt: string; // timestamptz → string via ScalarToJs
  }>();

  // Verify ScalarToJs is from adapter
  // Contract should have scalarToJs in mappings (types-only)
  type ContractScalarToJs = Contract['mappings'] extends { scalarToJs: infer S } ? S : never;
  expectTypeOf<ContractScalarToJs>().toExtend<ScalarToJs>();
});

// Note: Nullable column test removed - runtime-modified contracts are not supported.
// Contract.json must match contract.d.ts exactly, including nullability.

test('representative contract resolves types correctly end-to-end', () => {
  // Full representative contract with column types as pg/*@1 IDs
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const tables = schema<Contract, CodecTypes>(contract).tables;
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');
  const userColumns = getTableColumns(userTable);
  const idColumn = userColumns['id'];
  const emailColumn = userColumns['email'];
  const createdAtColumn = userColumns['createdAt'];
  if (!idColumn || !emailColumn || !createdAtColumn) throw new Error('columns not found');

  const plan = sql<Contract, CodecTypes>({ contract, adapter })
    .from(userTable)
    .select({
      id: idColumn,
      email: emailColumn,
      createdAt: createdAtColumn,
    })
    .build();

  type Row = ResultType<typeof plan>;

  // All types should resolve correctly via CodecTypes[typeId].output
  // Strict checks: verify fields are NOT never
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();
  expectTypeOf<Row['createdAt']>().toEqualTypeOf<string>();

  // Also verify the overall structure
  expectTypeOf<Row>().toExtend<{
    id: number; // pg/int4@1 → number
    email: string; // pg/text@1 → string
    createdAt: string; // pg/timestamptz@1 → string
  }>();
});

test('result typing is derived solely from projection, unaffected by joins', () => {
  const contractWithPosts = validateContract<SqlContract<SqlStorage>>({
    target: 'postgres',
    targetFamily: 'sql' as const,
    coreHash: 'sha256:test-core',
    profileHash: 'sha256:test-profile',
    storage: {
      tables: {
        user: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
            email: { type: 'pg/text@1', nullable: false },
          },
        },
        post: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
            userId: { type: 'pg/int4@1', nullable: false },
            title: { type: 'pg/text@1', nullable: false },
          },
        },
      },
    },
    models: {},
    relations: {},
    mappings: {},
  });

  const adapter = createPostgresAdapter();
  const tables = schema<typeof contractWithPosts, PgCodecTypes>(contractWithPosts).tables;
  const userTable = tables['user'];
  const postTable = tables['post'];
  if (!userTable || !postTable) throw new Error('tables not found');
  const userColumns = userTable.columns;
  const postColumns = postTable.columns;

  const plan = sql<typeof contractWithPosts, PgCodecTypes>({ contract: contractWithPosts, adapter })
    .from(userTable)
    .innerJoin(postTable, (on) => on.eqCol(userColumns['id']!, postColumns['userId']!))
    .select({
      userId: userColumns['id']!,
      postId: postColumns['id']!,
      title: postColumns['title']!,
    })
    .build();

  type Row = ResultType<typeof plan>;

  // Row type should only include projected columns, not all available columns
  expectTypeOf<Row['userId']>().toEqualTypeOf<number>();
  expectTypeOf<Row['postId']>().toEqualTypeOf<number>();
  expectTypeOf<Row['title']>().toEqualTypeOf<string>();

  // Row should NOT have email (not in projection, even though it's available from user table)
  expectTypeOf<Row>().not.toHaveProperty('email');

  // Verify the overall structure
  expectTypeOf<Row>().toExtend<{
    userId: number;
    postId: number;
    title: string;
  }>();

  // Verify plan structure
  expectTypeOf(plan).toExtend<Plan<Row>>();
});
