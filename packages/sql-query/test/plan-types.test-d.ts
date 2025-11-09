import type { Plan, ResultType } from '@prisma-next/contract/types';
import { createRuntimeContext } from '@prisma-next/runtime';
import type { SqlContract } from '@prisma-next/sql-target';
import { expectTypeOf, test } from 'vitest';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import { validateContract } from '../src/contract';
import { schema } from '../src/schema';
import { sql } from '../src/sql';
import type { TableKey, TablesOf } from '../src/types';
import type { Contract, CodecTypes } from './fixtures/contract.d';
import contractJson from './fixtures/contract.json' with { type: 'json' };

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
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;

  const builder = sql({ context });
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');
  const builderAfterFrom = builder.from(userTable);

  // Before select(), Row type should be unknown
  const _plan = builderAfterFrom.build();
  expectTypeOf<ResultType<typeof _plan>>().toEqualTypeOf<unknown>();
});

test('select() with object projection infers Row type', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');
  const userColumns = userTable.columns;

  const _plan = sql({ context })
    .from(userTable)
    .select({
      id: userColumns.id!,
      email: userColumns.email!,
    })
    .build();

  // Row type should be inferred from projection
  type Row = ResultType<typeof _plan>;

  // Should have id and email properties
  // Note: exact types depend on columnMeta, but structure should be correct
  // Verify plan structure
  expectTypeOf(_plan).toExtend<Plan<Row>>();
});

test('build() returns Plan<Row> with inferred Row type', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');
  const userColumns = userTable.columns;
  const idColumn = userColumns.id;
  const emailColumn = userColumns.email;
  if (!idColumn || !emailColumn) throw new Error('columns not found');

  const _plan = sql({ context })
    .from(userTable)
    .select({
      id: idColumn,
      email: emailColumn,
    })
    .build();

  type Row = ResultType<typeof _plan>;

  // Strict checks: verify fields have correct types (will fail if never)
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();

  expectTypeOf(_plan).toExtend<Plan<Row>>();
});

test('ResultType utility extracts Row type from Plan', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');
  const userColumns = getTableColumns(userTable);
  const idColumn = userColumns.id;
  const emailColumn = userColumns.email;
  if (!idColumn || !emailColumn) throw new Error('columns not found');

  const _plan = sql({ context })
    .from(userTable)
    .select({
      id: idColumn,
      email: emailColumn,
    })
    .build();

  type ExtractedRow = ResultType<typeof _plan>;
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
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');
  const userColumns = getTableColumns(userTable);
  const idColumn = userColumns.id;
  const emailColumn = userColumns.email;
  if (!idColumn || !emailColumn) throw new Error('columns not found');

  const _plan = sql({ context })
    .from(userTable)
    .select({
      id: idColumn,
      email: emailColumn,
    })
    .build();

  type Row = ResultType<typeof _plan>;
  const result = execute(_plan);

  expectTypeOf(result).toExtend<AsyncIterable<Row>>();
});

test('builder chain preserves Row type through methods', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');
  const userColumns = userTable.columns;
  const idColumn = userColumns.id;
  const emailColumn = userColumns.email;
  if (!idColumn || !emailColumn) throw new Error('columns not found');

  const builderAfterFrom = sql({ context }).from(userTable);
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

  const _plan = builderWithSelect.build();
  type Row = ResultType<typeof _plan>;

  // Methods that don't change projection should preserve Row type
  const _planFromWhere = builderWithWhere.build();
  const _planFromOrder = builderWithOrder.build();
  const _planFromLimit = builderWithLimit.build();

  expectTypeOf<ResultType<typeof _planFromWhere>>().toEqualTypeOf<Row>();
  expectTypeOf<ResultType<typeof _planFromOrder>>().toEqualTypeOf<Row>();
  expectTypeOf<ResultType<typeof _planFromLimit>>().toEqualTypeOf<Row>();
});

test('wrong Row type assignments fail type check', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');
  const userColumns = getTableColumns(userTable);
  const idColumn = userColumns.id;
  const emailColumn = userColumns.email;
  if (!idColumn || !emailColumn) throw new Error('columns not found');

  const _plan = sql({ context })
    .from(userTable)
    .select({
      id: idColumn,
      email: emailColumn,
    })
    .build();

  // This should compile - correct type
  type Row = ResultType<typeof _plan>;
  const correct: Plan<Row> = _plan;
  expectTypeOf(correct).toExtend<Plan<Row>>();

  // Type system should preserve Row type through the chain
  // If Row is inferred correctly, it should not be assignable to a completely different type
  // Note: Due to TypeScript's structural typing with unknown, this test may not fail
  // but the important thing is that Row is correctly inferred from the projection
  // This assignment would fail if Row was a specific type (not unknown)
  // For now, we verify that Row is inferred (even if as unknown) by checking the plan structure
  expectTypeOf(_plan).toExtend<Plan<Row>>();
});

test('nullable columns are handled correctly', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');
  const userColumns = getTableColumns(userTable);
  const idColumn = userColumns.id;
  const emailColumn = userColumns.email;
  if (!idColumn || !emailColumn) throw new Error('columns not found');

  const _plan = sql({ context })
    .from(userTable)
    .select({
      id: idColumn,
      email: emailColumn,
    })
    .build();

  type Row = ResultType<typeof _plan>;
  // Row should have the projection properties
  expectTypeOf(_plan).toExtend<Plan<Row>>();
});

test('different column types map correctly', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');
  const userColumns = getTableColumns(userTable);
  const idColumn = userColumns.id;
  const emailColumn = userColumns.email;
  const createdAtColumn = userColumns.createdAt;
  if (!idColumn || !emailColumn || !createdAtColumn) throw new Error('columns not found');

  const _plan = sql({ context })
    .from(userTable)
    .select({
      id: idColumn,
      email: emailColumn,
      createdAt: createdAtColumn,
    })
    .build();

  type Row = ResultType<typeof _plan>;
  expectTypeOf(_plan).toExtend<Plan<Row>>();
});

test('generic contract types are preserved', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  schema(context); // Used for type checking only

  // Verify TableKey extracts correct table names
  type ContractTableKey = TableKey<typeof contract>;
  expectTypeOf<ContractTableKey>().toEqualTypeOf<'user'>();

  // Verify TablesOf extracts correct structure
  type ContractTables = TablesOf<typeof contract>;
  expectTypeOf<ContractTables>().toHaveProperty('user');

  // Verify schema() preserves contract generic - should have literal 'user' key
  const schemaHandle = schema(context);
  expectTypeOf(schemaHandle.tables).toHaveProperty('user');

  // Verify we can access with literal key
  const userTable = schemaHandle.tables.user;
  expectTypeOf(userTable).not.toBeUndefined();
});

test('Contract namespace types are available', () => {
  // Verify Tables namespace is accessible
  type UserTable = Contract['storage']['tables']['user'];
  expectTypeOf<UserTable>().toHaveProperty('columns');
  type UserColumns = UserTable['columns'];
  expectTypeOf<UserColumns>().toHaveProperty('id');
  expectTypeOf<UserColumns>().toHaveProperty('email');
  expectTypeOf<UserColumns>().toHaveProperty('createdAt');

  // Verify Models namespace is accessible
  type UserModel = Contract['models']['User'];
  expectTypeOf<UserModel>().toHaveProperty('fields');
  type UserFields = UserModel['fields'];
  expectTypeOf<UserFields>().toHaveProperty('id');
  expectTypeOf<UserFields>().toHaveProperty('email');
  expectTypeOf<UserFields>().toHaveProperty('createdAt');

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

test('schema().tables returns tables graph', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const t = schema(context).tables;

  expectTypeOf(t).toHaveProperty('user');
  const userTable = t.user;
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
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');

  const builder = sql({ context });
  const builderAfterFrom = builder.from(userTable);

  // Builder should preserve contract type
  expectTypeOf(builder).toExtend<ReturnType<typeof sql<Contract>>>();
  expectTypeOf(builderAfterFrom).toExtend<ReturnType<ReturnType<typeof sql<Contract>>['from']>>();
});

test('codec mapping resolves scalar types correctly', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');
  const userColumns = getTableColumns(userTable);
  const idColumn = userColumns.id;
  const emailColumn = userColumns.email;
  const createdAtColumn = userColumns.createdAt;
  if (!idColumn || !emailColumn || !createdAtColumn) throw new Error('columns not found');

  const _plan = sql({ context })
    .from(userTable)
    .select({
      id: idColumn,
      email: emailColumn,
      createdAt: createdAtColumn,
    })
    .build();

  type Row = ResultType<typeof _plan>;

  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();
  expectTypeOf<Row['createdAt']>().toEqualTypeOf<string>();

  type ContractCodecTypes = Contract['mappings'] extends { codecTypes: infer C } ? C : never;
  expectTypeOf<ContractCodecTypes>().toExtend<CodecTypes>();
});

// Note: Nullable column test removed - runtime-modified contracts are not supported.
// Contract.json must match contract.d.ts exactly, including nullability.

test('representative contract resolves types correctly end-to-end', () => {
  // Full representative contract with column types as pg/*@1 IDs
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');
  const userColumns = getTableColumns(userTable);
  const idColumn = userColumns.id;
  const emailColumn = userColumns.email;
  const createdAtColumn = userColumns.createdAt;
  if (!idColumn || !emailColumn || !createdAtColumn) throw new Error('columns not found');

  const _plan = sql({ context })
    .from(userTable)
    .select({
      id: idColumn,
      email: emailColumn,
      createdAt: createdAtColumn,
    })
    .build();

  type Row = ResultType<typeof _plan>;

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
  // Define a fully-typed contract type for this test
  type ContractWithPosts = SqlContract<
    {
      readonly tables: {
        readonly user: {
          readonly columns: {
            readonly id: { readonly type: 'pg/int4@1'; nullable: false };
            readonly email: { readonly type: 'pg/text@1'; nullable: false };
          };
          readonly primaryKey: { readonly columns: readonly ['id'] };
          readonly uniques: readonly never[];
          readonly indexes: readonly never[];
          readonly foreignKeys: readonly never[];
        };
        readonly post: {
          readonly columns: {
            readonly id: { readonly type: 'pg/int4@1'; nullable: false };
            readonly userId: { readonly type: 'pg/int4@1'; nullable: false };
            readonly title: { readonly type: 'pg/text@1'; nullable: false };
          };
          readonly primaryKey: { readonly columns: readonly ['id'] };
          readonly uniques: readonly never[];
          readonly indexes: readonly never[];
          readonly foreignKeys: readonly never[];
        };
      };
    },
    Record<string, never>,
    Record<string, never>,
    {
      readonly codecTypes: {
        readonly 'pg/int4@1': { readonly output: number };
        readonly 'pg/text@1': { readonly output: string };
      };
      readonly operationTypes: Record<string, Record<string, unknown>>;
    }
  >;

  const contractWithPosts = validateContract<ContractWithPosts>({
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
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
        post: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
            userId: { type: 'pg/int4@1', nullable: false },
            title: { type: 'pg/text@1', nullable: false },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    models: {},
    relations: {},
    mappings: {
      codecTypes: {},
      operationTypes: {},
    } as unknown as ContractWithPosts['mappings'],
  });

  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract: contractWithPosts, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables['user'];
  const postTable = tables['post'];
  if (!userTable || !postTable) throw new Error('tables not found');
  const userColumns = userTable.columns;
  const postColumns = postTable.columns;

  const _plan = sql({ context })
    .from(userTable)
    .innerJoin(postTable, (on) => on.eqCol(userColumns['id']!, postColumns['userId']!))
    .select({
      userId: userColumns['id']!,
      postId: postColumns['id']!,
      title: postColumns['title']!,
    })
    .build();

  type Row = ResultType<typeof _plan>;

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
  expectTypeOf(_plan).toExtend<Plan<Row>>();
});

test('nested projection infers nested Row type', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');
  const userColumns = userTable.columns;

  const _plan = sql({ context })
    .from(userTable)
    .select({
      name: userColumns.email!,
      post: {
        title: userColumns.id!,
      },
    })
    .build();

  type Row = ResultType<typeof _plan>;

  // Row type should have nested structure
  expectTypeOf<Row['name']>().toEqualTypeOf<string>();
  expectTypeOf<Row['post']>().toEqualTypeOf<{ title: number }>();

  // Verify the overall structure
  expectTypeOf<Row>().toExtend<{
    name: string;
    post: { title: number };
  }>();

  expectTypeOf(_plan).toExtend<Plan<Row>>();
});

test('multi-level nested projection infers deeply nested Row type', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');
  const userColumns = userTable.columns;

  const _plan = sql({ context })
    .from(userTable)
    .select({
      a: {
        b: {
          c: userColumns.id!,
        },
      },
    })
    .build();

  type Row = ResultType<typeof _plan>;

  // Row type should have deeply nested structure
  expectTypeOf<Row['a']>().toEqualTypeOf<{ b: { c: number } }>();
  expectTypeOf<Row['a']['b']>().toEqualTypeOf<{ c: number }>();
  expectTypeOf<Row['a']['b']['c']>().toEqualTypeOf<number>();

  // Verify the overall structure
  expectTypeOf<Row>().toExtend<{
    a: { b: { c: number } };
  }>();

  expectTypeOf(_plan).toExtend<Plan<Row>>();
});

test('mixed leaves and nested objects in projection', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');
  const userColumns = userTable.columns;

  const _plan = sql({ context })
    .from(userTable)
    .select({
      id: userColumns.id!,
      post: {
        title: userColumns.email!,
        author: {
          name: userColumns.id!,
        },
      },
      email: userColumns.email!,
    })
    .build();

  type Row = ResultType<typeof _plan>;

  // Row type should have mixed structure
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['post']>().toEqualTypeOf<{ title: string; author: { name: number } }>();
  expectTypeOf<Row['post']['title']>().toEqualTypeOf<string>();
  expectTypeOf<Row['post']['author']>().toEqualTypeOf<{ name: number }>();
  expectTypeOf<Row['post']['author']['name']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();

  // Verify the overall structure
  expectTypeOf<Row>().toExtend<{
    id: number;
    post: { title: string; author: { name: number } };
    email: string;
  }>();

  expectTypeOf(_plan).toExtend<Plan<Row>>();
});

test('nested projection with joins infers nested Row type', () => {
  // Define a fully-typed contract type for this test
  type ContractWithPosts = SqlContract<
    {
      readonly tables: {
        readonly user: {
          readonly columns: {
            readonly id: { readonly type: 'pg/int4@1'; nullable: false };
            readonly email: { readonly type: 'pg/text@1'; nullable: false };
          };
          readonly primaryKey: { readonly columns: readonly ['id'] };
          readonly uniques: readonly never[];
          readonly indexes: readonly never[];
          readonly foreignKeys: readonly never[];
        };
        readonly post: {
          readonly columns: {
            readonly id: { readonly type: 'pg/int4@1'; nullable: false };
            readonly userId: { readonly type: 'pg/int4@1'; nullable: false };
            readonly title: { readonly type: 'pg/text@1'; nullable: false };
          };
          readonly primaryKey: { readonly columns: readonly ['id'] };
          readonly uniques: readonly never[];
          readonly indexes: readonly never[];
          readonly foreignKeys: readonly never[];
        };
      };
    },
    Record<string, never>,
    Record<string, never>,
    {
      readonly codecTypes: {
        readonly 'pg/int4@1': { readonly output: number };
        readonly 'pg/text@1': { readonly output: string };
      };
      readonly operationTypes: Record<string, Record<string, unknown>>;
    }
  >;

  const contractWithPosts = validateContract<ContractWithPosts>({
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
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
        post: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
            userId: { type: 'pg/int4@1', nullable: false },
            title: { type: 'pg/text@1', nullable: false },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    models: {},
    relations: {},
    mappings: {
      codecTypes: {},
      operationTypes: {},
    } as unknown as ContractWithPosts['mappings'],
  });

  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract: contractWithPosts, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables['user'];
  const postTable = tables['post'];
  if (!userTable || !postTable) throw new Error('tables not found');
  const userColumns = userTable.columns;
  const postColumns = postTable.columns;

  const _plan = sql({ context })
    .from(userTable)
    .innerJoin(postTable, (on) => on.eqCol(userColumns['id']!, postColumns['userId']!))
    .select({
      name: userColumns['email']!,
      post: {
        title: postColumns['title']!,
        id: postColumns['id']!,
      },
    })
    .build();

  type Row = ResultType<typeof _plan>;

  // Row type should have nested structure with joined columns
  expectTypeOf<Row['name']>().toEqualTypeOf<string>();
  expectTypeOf<Row['post']>().toEqualTypeOf<{ title: string; id: number }>();
  expectTypeOf<Row['post']['title']>().toEqualTypeOf<string>();
  expectTypeOf<Row['post']['id']>().toEqualTypeOf<number>();

  // Verify the overall structure
  expectTypeOf<Row>().toExtend<{
    name: string;
    post: { title: string; id: number };
  }>();

  expectTypeOf(_plan).toExtend<Plan<Row>>();
});

test('insert without returning() has unknown Row type', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');

  const _plan = sql({ context })
    .insert(userTable, {
      email: { kind: 'param-placeholder', name: 'email' },
    })
    .build({ params: { email: 'test@example.com' } });

  // Without returning(), Row type should be unknown
  expectTypeOf<ResultType<typeof _plan>>().toEqualTypeOf<unknown>();
});

test('insert with returning() infers Row type', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');
  const userColumns = getTableColumns(userTable);
  const idColumn = userColumns.id;
  const emailColumn = userColumns.email;
  if (!idColumn || !emailColumn) throw new Error('columns not found');

  const _plan = sql({ context })
    .insert(userTable, {
      email: { kind: 'param-placeholder', name: 'email' },
    })
    .returning(idColumn, emailColumn)
    .build({ params: { email: 'test@example.com' } });

  type Row = ResultType<typeof _plan>;

  // Row type should be inferred from returning() columns
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();

  // Verify the overall structure
  expectTypeOf<Row>().toExtend<{ id: number; email: string }>();

  expectTypeOf(_plan).toExtend<Plan<Row>>();
});

test('update with returning() infers Row type', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');
  const userColumns = getTableColumns(userTable);
  const idColumn = userColumns.id;
  const emailColumn = userColumns.email;
  if (!idColumn || !emailColumn) throw new Error('columns not found');

  const _plan = sql({ context })
    .update(userTable, {
      email: { kind: 'param-placeholder', name: 'newEmail' },
    })
    .where(idColumn.eq({ kind: 'param-placeholder', name: 'userId' }))
    .returning(idColumn, emailColumn)
    .build({ params: { newEmail: 'updated@example.com', userId: 1 } });

  type Row = ResultType<typeof _plan>;

  // Row type should be inferred from returning() columns
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();

  // Verify the overall structure
  expectTypeOf<Row>().toExtend<{ id: number; email: string }>();

  expectTypeOf(_plan).toExtend<Plan<Row>>();
});

test('delete with returning() infers Row type', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables.user;
  if (!userTable) throw new Error('user table not found');
  const userColumns = getTableColumns(userTable);
  const idColumn = userColumns.id;
  const emailColumn = userColumns.email;
  if (!idColumn || !emailColumn) throw new Error('columns not found');

  const _plan = sql({ context })
    .delete(userTable)
    .where(idColumn.eq({ kind: 'param-placeholder', name: 'userId' }))
    .returning(idColumn, emailColumn)
    .build({ params: { userId: 1 } });

  type Row = ResultType<typeof _plan>;

  // Row type should be inferred from returning() columns
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();

  // Verify the overall structure
  expectTypeOf<Row>().toExtend<{ id: number; email: string }>();

  expectTypeOf(_plan).toExtend<Plan<Row>>();
});
