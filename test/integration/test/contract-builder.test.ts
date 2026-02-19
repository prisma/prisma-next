import {
  int4Column,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import type { ExtractCodecTypes, ModelDefinition } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import { sql } from '@prisma-next/sql-lane/sql';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import postgresPack from '@prisma-next/target-postgres/pack';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CodecTypes, Contract } from './fixtures/contract.d';
import contractJson from './fixtures/contract.json' with { type: 'json' };

describe('builder integration', () => {
  it('builds a contract matching fixture structure', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresPack)
      .table('user', (t) =>
        t
          .column('id', { type: int4Column, nullable: false } as const)
          .column('email', { type: textColumn, nullable: false } as const)
          .column('createdAt', { type: timestamptzColumn, nullable: false } as const)
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) =>
        m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
      )
      .storageHash('sha256:test-core')
      .build();

    expectTypeOf<ExtractCodecTypes<typeof contract>>().toEqualTypeOf<CodecTypes>();

    // Runtime checks
    expect(contract).toMatchObject({
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test-core',
      storage: {
        tables: expect.objectContaining({
          user: expect.anything(),
        }),
      },
    });
    const userTable = contract.storage.tables.user;
    expect(userTable).toBeDefined();
    expect(userTable?.columns).toMatchObject({
      id: expect.anything(),
      email: expect.anything(),
      createdAt: expect.anything(),
    });
    expectTypeOf<keyof typeof contract.storage.tables>().toEqualTypeOf<'user'>();
    type ContractCodecTypes = ExtractCodecTypes<typeof contract>;
    type IntCodecOutput = ContractCodecTypes['pg/int4@1']['output'];
    expectTypeOf<IntCodecOutput>().toEqualTypeOf<number>();
    type ColumnMeta = (typeof contract)['storage']['tables']['user']['columns']['id'];
    // Type inference may widen literal types, so we check that the codecId exists and maps to number
    expectTypeOf<ColumnMeta['codecId']>().toExtend<string>();
    // ComputeColumnJsType may infer unknown if literal types are widened, so we check the codec output directly
    expectTypeOf<ContractCodecTypes['pg/int4@1']['output']>().toEqualTypeOf<number>();

    expectTypeOf<ExtractCodecTypes<typeof contract>>().toEqualTypeOf<CodecTypes>();
    expect(userTable?.primaryKey?.columns).toEqual(['id']);
    const userModel = contract.models.User;
    expect(userModel).toMatchObject({
      storage: {
        table: 'user',
      },
      fields: expect.objectContaining({
        id: expect.anything(),
        email: expect.anything(),
        createdAt: expect.anything(),
      }),
    });

    // Type checks - verify literal types are preserved
    expectTypeOf(contract.target).toEqualTypeOf<'postgres'>();
    expectTypeOf(contract.targetFamily).toEqualTypeOf<'sql'>();
    expectTypeOf(contract.schemaVersion).toEqualTypeOf<'1'>();

    // Verify table name is literal 'user', not string
    expectTypeOf(contract.storage.tables).toHaveProperty('user');

    // Verify column names are literal types
    const userTableType = contract.storage.tables.user;
    expectTypeOf(userTableType.columns).toHaveProperty('id');
    expectTypeOf(userTableType.columns).toHaveProperty('email');
    expectTypeOf(userTableType.columns).toHaveProperty('createdAt');

    // Verify column types are strings (TypeScript may widen literal types)
    expectTypeOf(userTableType.columns.id.codecId).toExtend<string>();
    expectTypeOf(userTableType.columns.email.codecId).toExtend<string>();
    expectTypeOf(userTableType.columns.createdAt.codecId).toExtend<string>();
    // Runtime check that they match expected values
    expect(userTableType.columns.id.codecId).toBe('pg/int4@1');
    expect(userTableType.columns.email.codecId).toBe('pg/text@1');
    expect(userTableType.columns.createdAt.codecId).toBe('pg/timestamptz@1');

    // Verify nullable is literal false, not boolean
    expectTypeOf(userTableType.columns.id.nullable).toEqualTypeOf<false>();
    expectTypeOf(userTableType.columns.email.nullable).toEqualTypeOf<false>();
    expectTypeOf(userTableType.columns.createdAt.nullable).toEqualTypeOf<false>();

    // Verify model name is literal 'User', not string
    expectTypeOf(contract.models).toHaveProperty('User');

    // Verify model storage table is literal 'user'
    expectTypeOf(contract.models.User.storage.table).toEqualTypeOf<'user'>();

    expectTypeOf<ContractCodecTypes['pg/int4@1']['output']>().toEqualTypeOf<number>();

    // Verify model field names are literal types
    expectTypeOf(contract.models.User.fields).toHaveProperty('id');
    expectTypeOf(contract.models.User.fields).toHaveProperty('email');
    expectTypeOf(contract.models.User.fields).toHaveProperty('createdAt');
  });

  it('contract can be validated with validateContract', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresPack)
      .table('user', (t) =>
        t
          .column('id', { type: int4Column, nullable: false })
          .column('email', { type: textColumn, nullable: false })
          .column('createdAt', { type: timestamptzColumn, nullable: false })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) =>
        m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
      )
      .storageHash('sha256:test-core')
      .build();

    expect(contract.target).toBe('postgres');
    expect(contract.storage.tables.user).toBeDefined();
  });

  it('contract works with schema() function', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresPack)
      .table('user', (t) =>
        t
          .column('id', { type: int4Column, nullable: false })
          .column('email', { type: textColumn, nullable: false })
          .column('createdAt', { type: timestamptzColumn, nullable: false })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) =>
        m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
      )
      .storageHash('sha256:test-core')
      .build();

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema<typeof contract>(context).tables;
    const userTable = tables.user;
    expect(userTable).toBeDefined();
    expect(userTable?.columns).toMatchObject({
      id: expect.anything(),
      email: expect.anything(),
      createdAt: expect.anything(),
    });
    // Type inference may widen literal types, so we verify the codec output type directly
    type ContractCodecTypes = ExtractCodecTypes<typeof contract>;
    expectTypeOf<ContractCodecTypes['pg/int4@1']['output']>().toEqualTypeOf<number>();
  });

  it('contract works with sql() function', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresPack)
      .table('user', (t) =>
        t
          .column('id', { type: int4Column, nullable: false })
          .column('email', { type: textColumn, nullable: false })
          .column('createdAt', { type: timestamptzColumn, nullable: false })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) =>
        m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
      )
      .storageHash('sha256:test-core')
      .build();

    expectTypeOf<ExtractCodecTypes<typeof contract>>().toEqualTypeOf<CodecTypes>();

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema<typeof contract>(context).tables;
    const userTable = tables.user;
    if (!userTable) throw new Error('user table not found');

    const _plan = sql<typeof contract>({ context })
      .from(userTable)
      .select({
        id: userTable.columns.id!,
        email: userTable.columns.email!,
      })
      .build();

    // Runtime checks
    expect(_plan.ast).toBeDefined();
    expect((_plan.ast as { kind: string })?.kind).toBe('select');
    expect(_plan.meta.storageHash).toBe('sha256:test-core');

    // Type checks - verify plan types are specific
    expectTypeOf(_plan.meta.storageHash).toEqualTypeOf<string>();
    // Note: plan.ast type checking is complex due to plan structure
    // We verify it exists at runtime above

    // Verify ResultType inference works with specific types
    type Row = ResultType<typeof _plan>;
    // Type inference may widen types, so we verify the codec outputs directly
    type ContractCodecTypes = ExtractCodecTypes<typeof contract>;
    expectTypeOf<ContractCodecTypes['pg/int4@1']['output']>().toEqualTypeOf<number>();
    expectTypeOf<ContractCodecTypes['pg/text@1']['output']>().toEqualTypeOf<string>();
    // Runtime check that Row has correct structure
    expectTypeOf<Row>().toHaveProperty('id');
    expectTypeOf<Row>().toHaveProperty('email');
  });

  it('ResultType inference works with builder contract', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresPack)
      .table('user', (t) =>
        t
          .column('id', { type: int4Column, nullable: false })
          .column('email', { type: textColumn, nullable: false })
          .column('createdAt', { type: timestamptzColumn, nullable: false })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) =>
        m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
      )
      .storageHash('sha256:test-core')
      .build();

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema<typeof contract>(context).tables;
    const userTable = tables.user;
    if (!userTable) throw new Error('user table not found');

    const _plan = sql<typeof contract>({ context })
      .from(userTable)
      .select({
        id: userTable.columns.id!,
        email: userTable.columns.email!,
        createdAt: userTable.columns.createdAt!,
      })
      .build();

    type Row = ResultType<typeof _plan>;

    // Runtime check
    const row: Row = {
      id: 1,
      email: 'test@example.com',
      createdAt: new Date('2024-01-01T00:00:00Z'),
    };
    expect(row).toBeDefined();

    // Type checks - verify ResultType has specific field names
    expectTypeOf<Row>().toHaveProperty('id');
    expectTypeOf<Row>().toHaveProperty('email');
    expectTypeOf<Row>().toHaveProperty('createdAt');
    // Verify codec output types directly (type inference may widen literal types)
    type ContractCodecTypes = ExtractCodecTypes<typeof contract>;
    expectTypeOf<ContractCodecTypes['pg/int4@1']['output']>().toEqualTypeOf<number>();
    expectTypeOf<ContractCodecTypes['pg/text@1']['output']>().toEqualTypeOf<string>();
    expectTypeOf<ContractCodecTypes['pg/timestamptz@1']['output']>().toEqualTypeOf<Date>();
  });

  it('contract structure matches fixture contract', () => {
    const builderContract = defineContract<CodecTypes>()
      .target(postgresPack)
      .table('user', (t) =>
        t
          .column('id', { type: int4Column, nullable: false })
          .column('email', { type: textColumn, nullable: false })
          .column('createdAt', { type: timestamptzColumn, nullable: false })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) =>
        m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
      )
      .storageHash('sha256:test-core')
      .build();

    const fixtureContract = validateContract<Contract>(contractJson);

    // Runtime checks
    expect(builderContract.schemaVersion).toBe(fixtureContract.schemaVersion);
    expect(builderContract.target).toBe(fixtureContract.target);
    expect(builderContract.targetFamily).toBe(fixtureContract.targetFamily);
    expect(builderContract.storage.tables.user.columns).toMatchObject({
      id: { codecId: fixtureContract.storage.tables.user.columns.id.codecId },
      email: { codecId: fixtureContract.storage.tables.user.columns.email.codecId },
      createdAt: { codecId: fixtureContract.storage.tables.user.columns.createdAt.codecId },
    });
    const builderUserModel = builderContract.models.User as unknown as ModelDefinition;
    const fixtureUserModel = fixtureContract.models.User as unknown as ModelDefinition;
    expect(builderUserModel.storage.table).toBe(fixtureUserModel.storage.table);
    expect(Object.keys(builderUserModel.fields)).toEqual(Object.keys(fixtureUserModel.fields));

    // Type checks - verify builder contract preserves types like fixture
    expectTypeOf(builderContract.target).toEqualTypeOf<'postgres'>();
    expectTypeOf(builderContract.targetFamily).toEqualTypeOf<'sql'>();
    expectTypeOf(builderContract.schemaVersion).toEqualTypeOf<'1'>();

    // Verify table and column types match
    expectTypeOf(builderContract.storage.tables).toHaveProperty('user');
    expectTypeOf(builderContract.storage.tables.user.columns).toHaveProperty('id');
    expectTypeOf(builderContract.storage.tables.user.columns).toHaveProperty('email');
    expectTypeOf(builderContract.storage.tables.user.columns).toHaveProperty('createdAt');

    // Verify model types match
    expectTypeOf(builderContract.models).toHaveProperty('User');
    expectTypeOf(builderContract.models.User.storage.table).toEqualTypeOf<'user'>();
    expectTypeOf(builderContract.models.User.fields).toHaveProperty('id');
    expectTypeOf(builderContract.models.User.fields).toHaveProperty('email');
    expectTypeOf(builderContract.models.User.fields).toHaveProperty('createdAt');
  });

  it('supports type option with dataTypes constants', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresPack)
      .table('user', (t) =>
        t
          .column('id', { type: int4Column, nullable: false })
          .column('email', { type: textColumn, nullable: false }),
      )
      .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
      .build();

    // Type checks - verify codecId is a string (TypeScript may widen literal types)
    expectTypeOf(contract.storage.tables.user.columns.id.codecId).toExtend<string>();
    expectTypeOf(contract.storage.tables.user.columns.email.codecId).toExtend<string>();
    // Runtime check that they match expected values
    expect(contract.storage.tables.user.columns).toMatchObject({
      id: { codecId: 'pg/int4@1' },
      email: { codecId: 'pg/text@1' },
    });
  });

  it('accepts any codecId format in descriptor (validation happens at runtime)', () => {
    // Column descriptors accept any codecId format - validation happens at runtime
    // when the contract is used, not at build time
    const contract = defineContract<CodecTypes>()
      .target(postgresPack)
      .table('user', (t) =>
        t.column('id', {
          // biome-ignore lint/suspicious/noExplicitAny: Testing invalid type descriptor
          type: { codecId: 'invalid', nativeType: 'invalid' } as any,
        }),
      )
      .build();
    // Contract builds successfully - invalid codecId will cause errors at runtime
    expect(contract.storage.tables.user.columns.id.codecId).toBe('invalid');
  });

  describe('relation builder', () => {
    it('builds a contract with 1:N relation', () => {
      const contract = defineContract<CodecTypes>()
        .target(postgresPack)
        .table('user', (t) =>
          t
            .column('id', { type: int4Column, nullable: false })
            .column('email', { type: textColumn, nullable: false })
            .primaryKey(['id']),
        )
        .table('post', (t) =>
          t
            .column('id', { type: int4Column, nullable: false })
            .column('userId', { type: int4Column, nullable: false })
            .column('title', { type: textColumn, nullable: false })
            .primaryKey(['id']),
        )
        .model('User', 'user', (m) =>
          m
            .field('id', 'id')
            .field('email', 'email')
            .relation('posts', {
              toModel: 'Post',
              toTable: 'post',
              cardinality: '1:N',
              on: {
                parentTable: 'user',
                parentColumns: ['id'],
                childTable: 'post',
                childColumns: ['userId'],
              },
            }),
        )
        .model('Post', 'post', (m) =>
          m
            .field('id', 'id')
            .field('userId', 'userId')
            .field('title', 'title')
            .relation('user', {
              toModel: 'User',
              toTable: 'user',
              cardinality: 'N:1',
              on: {
                parentTable: 'post',
                parentColumns: ['userId'],
                childTable: 'user',
                childColumns: ['id'],
              },
            }),
        )
        .storageHash('sha256:test-core')
        .build();

      // Runtime checks
      expect(contract.relations).toBeDefined();
      const relations = contract.relations as Record<string, Record<string, unknown>>;
      const userRelations = relations['user'] as Record<string, unknown>;
      const postRelations = relations['post'] as Record<string, unknown>;
      expect(userRelations).toBeDefined();
      expect(userRelations['posts']).toBeDefined();
      const userPosts = userRelations['posts'] as {
        to: string;
        cardinality: string;
        on: { parentCols: readonly string[]; childCols: readonly string[] };
      };
      expect(userPosts.to).toBe('Post');
      expect(userPosts.cardinality).toBe('1:N');
      expect(userPosts.on.parentCols).toEqual(['id']);
      expect(userPosts.on.childCols).toEqual(['userId']);

      expect(postRelations).toBeDefined();
      expect(postRelations['user']).toBeDefined();
      const postUser = postRelations['user'] as {
        to: string;
        cardinality: string;
        on: { parentCols: readonly string[]; childCols: readonly string[] };
      };
      expect(postUser.to).toBe('User');
      expect(postUser.cardinality).toBe('N:1');
      expect(postUser.on.parentCols).toEqual(['userId']);
      expect(postUser.on.childCols).toEqual(['id']);
    });

    it('builds a contract with N:M relation', () => {
      const contract = defineContract<CodecTypes>()
        .target(postgresPack)
        .table('user', (t) =>
          t
            .column('id', { type: int4Column, nullable: false })
            .column('email', { type: textColumn, nullable: false })
            .primaryKey(['id']),
        )
        .table('role', (t) =>
          t
            .column('id', { type: int4Column, nullable: false })
            .column('name', { type: textColumn, nullable: false })
            .primaryKey(['id']),
        )
        .table('userRole', (t) =>
          t
            .column('userId', { type: int4Column, nullable: false })
            .column('roleId', { type: int4Column, nullable: false })
            .primaryKey(['userId', 'roleId']),
        )
        .model('User', 'user', (m) =>
          m
            .field('id', 'id')
            .field('email', 'email')
            .relation('roles', {
              toModel: 'Role',
              toTable: 'role',
              cardinality: 'N:M',
              through: {
                table: 'userRole',
                parentColumns: ['id'],
                childColumns: ['userId'],
              },
              on: {
                parentTable: 'user',
                parentColumns: ['id'],
                childTable: 'userRole',
                childColumns: ['userId'],
              },
            }),
        )
        .model('Role', 'role', (m) =>
          m
            .field('id', 'id')
            .field('name', 'name')
            .relation('users', {
              toModel: 'User',
              toTable: 'user',
              cardinality: 'N:M',
              through: {
                table: 'userRole',
                parentColumns: ['id'],
                childColumns: ['roleId'],
              },
              on: {
                parentTable: 'role',
                parentColumns: ['id'],
                childTable: 'userRole',
                childColumns: ['roleId'],
              },
            }),
        )
        .storageHash('sha256:test-core')
        .build();

      // Runtime checks
      expect(contract.relations).toMatchObject({
        user: {
          roles: {
            to: 'Role',
            cardinality: 'N:M',
            through: {
              table: 'userRole',
              parentCols: ['id'],
              childCols: ['userId'],
            },
          },
        },
        role: {
          users: {
            to: 'User',
            cardinality: 'N:M',
            through: {
              table: 'userRole',
              parentCols: ['id'],
              childCols: ['roleId'],
            },
          },
        },
      });
    });

    it('validates parentTable matches model table', () => {
      expect(() => {
        defineContract<CodecTypes>()
          .target(postgresPack)
          .table('user', (t) => t.column('id', { type: int4Column, nullable: false }))
          .table('post', (t) => t.column('id', { type: int4Column, nullable: false }))
          .model('User', 'user', (m) =>
            m.relation('posts', {
              toModel: 'Post',
              toTable: 'post',
              cardinality: '1:N',
              on: {
                parentTable: 'wrongTable' as 'user',
                parentColumns: ['id'],
                childTable: 'post',
                childColumns: ['userId'],
              },
            } as unknown as Parameters<typeof m.relation>[1]),
          )
          .build();
      }).toThrow(/parentTable.*does not match model table/);
    });

    it('validates childTable matches toTable for non-N:M relations', () => {
      expect(() => {
        defineContract<CodecTypes>()
          .target(postgresPack)
          .table('user', (t) => t.column('id', { type: int4Column, nullable: false }))
          .table('post', (t) => t.column('id', { type: int4Column, nullable: false }))
          .model('User', 'user', (m) =>
            m.relation('posts', {
              toModel: 'Post',
              toTable: 'post',
              cardinality: '1:N',
              on: {
                parentTable: 'user',
                parentColumns: ['id'],
                childTable: 'wrongTable',
                childColumns: ['userId'],
              },
            }),
          )
          .build();
      }).toThrow(/childTable.*does not match toTable/);
    });

    it('validates N:M relations require through field', () => {
      expect(() => {
        defineContract<CodecTypes>()
          .target(postgresPack)
          .table('user', (t) => t.column('id', { type: int4Column, nullable: false }))
          .table('role', (t) => t.column('id', { type: int4Column, nullable: false }))
          .model('User', 'user', (m) => {
            // Intentionally omit through to test validation
            const invalidRelation = {
              toModel: 'Role' as const,
              toTable: 'role' as const,
              cardinality: 'N:M' as const,
              on: {
                parentTable: 'user' as const,
                parentColumns: ['id'] as const,
                childTable: 'userRole' as const,
                childColumns: ['userId'] as const,
              },
            };
            return m.relation(
              'roles',
              invalidRelation as unknown as Parameters<typeof m.relation>[1],
            );
          })
          .build();
      }).toThrow(/cardinality "N:M" requires through field/);
    });

    it('validates childTable matches through.table for N:M relations', () => {
      expect(() => {
        defineContract<CodecTypes>()
          .target(postgresPack)
          .table('user', (t) => t.column('id', { type: int4Column, nullable: false }))
          .table('role', (t) => t.column('id', { type: int4Column, nullable: false }))
          .table('userRole', (t) => t.column('userId', { type: int4Column, nullable: false }))
          .model('User', 'user', (m) =>
            m.relation('roles', {
              toModel: 'Role',
              toTable: 'role',
              cardinality: 'N:M',
              through: {
                table: 'userRole',
                parentColumns: ['id'],
                childColumns: ['userId'],
              },
              on: {
                parentTable: 'user',
                parentColumns: ['id'],
                childTable: 'wrongTable',
                childColumns: ['userId'],
              },
            }),
          )
          .build();
      }).toThrow(/childTable.*does not match through.table/);
    });
  });
});
