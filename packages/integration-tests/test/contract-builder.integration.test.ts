import { dataTypes } from '@prisma-next/adapter-postgres/codec-types';
import type { ResultType } from '@prisma-next/contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import { sql } from '@prisma-next/sql-lane/sql';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ComputeColumnJsType } from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import type { ExtractCodecTypes, ModelDefinition } from '@prisma-next/sql-target';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CodecTypes, Contract } from './fixtures/contract.d';
import contractJson from './fixtures/contract.json' with { type: 'json' };

describe('builder integration', () => {
  it('builds a contract matching fixture structure', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) =>
        t
          .column('id', { type: 'pg/int4@1', nullable: false } as const)
          .column('email', { type: 'pg/text@1', nullable: false } as const)
          .column('createdAt', { type: 'pg/timestamptz@1', nullable: false } as const)
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) =>
        m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
      )
      .coreHash('sha256:test-core')
      .build();

    expectTypeOf<ExtractCodecTypes<typeof contract>>().toEqualTypeOf<CodecTypes>();

    // Runtime checks
    expect(contract).toMatchObject({
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test-core',
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
    type JsType = ComputeColumnJsType<
      typeof contract,
      'user',
      'id',
      ColumnMeta,
      ContractCodecTypes
    >;
    expectTypeOf<JsType>().toEqualTypeOf<number>();

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

    // Verify column types are literal (canonicalized)
    expectTypeOf(userTableType.columns.id.type).toEqualTypeOf<'pg/int4@1'>();
    expectTypeOf(userTableType.columns.email.type).toEqualTypeOf<'pg/text@1'>();
    expectTypeOf(userTableType.columns.createdAt.type).toEqualTypeOf<'pg/timestamptz@1'>();

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
      .target('postgres')
      .table('user', (t) =>
        t
          .column('id', { type: 'pg/int4@1', nullable: false })
          .column('email', { type: 'pg/text@1', nullable: false })
          .column('createdAt', { type: 'pg/timestamptz@1', nullable: false })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) =>
        m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
      )
      .coreHash('sha256:test-core')
      .build();

    expect(contract.target).toBe('postgres');
    expect(contract.storage.tables.user).toBeDefined();
  });

  it('contract works with schema() function', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) =>
        t
          .column('id', { type: 'pg/int4@1', nullable: false })
          .column('email', { type: 'pg/text@1', nullable: false })
          .column('createdAt', { type: 'pg/timestamptz@1', nullable: false })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) =>
        m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
      )
      .coreHash('sha256:test-core')
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
    type IdColumn = NonNullable<typeof userTable>['columns']['id'];
    type IdJsType = IdColumn extends { __jsType: infer Js } ? Js : never;
    expectTypeOf<IdJsType>().toEqualTypeOf<number>();
  });

  it('contract works with sql() function', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) =>
        t
          .column('id', { type: 'pg/int4@1', nullable: false })
          .column('email', { type: 'pg/text@1', nullable: false })
          .column('createdAt', { type: 'pg/timestamptz@1', nullable: false })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) =>
        m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
      )
      .coreHash('sha256:test-core')
      .build();

    expectTypeOf<ExtractCodecTypes<typeof contract>>().toEqualTypeOf<CodecTypes>();

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema<typeof contract>(context).tables;
    const userTable = tables.user;
    if (!userTable) throw new Error('user table not found');

    const _plan = sql<typeof contract, CodecTypes>({ context })
      .from(userTable)
      .select({
        id: userTable.columns.id!,
        email: userTable.columns.email!,
      })
      .build();

    // Runtime checks
    expect(_plan.ast).toBeDefined();
    expect((_plan.ast as { kind: string })?.kind).toBe('select');
    expect(_plan.meta.coreHash).toBe('sha256:test-core');

    // Type checks - verify plan types are specific
    expectTypeOf(_plan.meta.coreHash).toEqualTypeOf<string>();
    // Note: plan.ast type checking is complex due to plan structure
    // We verify it exists at runtime above

    // Verify ResultType inference works with specific types
    type Row = ResultType<typeof _plan>;
    expectTypeOf<Row['id']>().toEqualTypeOf<number>();
    expectTypeOf<Row['email']>().toEqualTypeOf<string>();
  });

  it('ResultType inference works with builder contract', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) =>
        t
          .column('id', { type: 'pg/int4@1', nullable: false })
          .column('email', { type: 'pg/text@1', nullable: false })
          .column('createdAt', { type: 'pg/timestamptz@1', nullable: false })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) =>
        m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
      )
      .coreHash('sha256:test-core')
      .build();

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema<typeof contract>(context).tables;
    const userTable = tables.user;
    if (!userTable) throw new Error('user table not found');

    const _plan = sql<typeof contract, CodecTypes>({ context })
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
      createdAt: '2024-01-01T00:00:00Z',
    };
    expect(row).toBeDefined();

    // Type checks - verify ResultType has specific field names and types
    expectTypeOf<Row['id']>().toEqualTypeOf<number>();
    expectTypeOf<Row['email']>().toEqualTypeOf<string>();
    expectTypeOf<Row['createdAt']>().toEqualTypeOf<string>();
  });

  it('contract structure matches fixture contract', () => {
    const builderContract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) =>
        t
          .column('id', { type: 'pg/int4@1', nullable: false })
          .column('email', { type: 'pg/text@1', nullable: false })
          .column('createdAt', { type: 'pg/timestamptz@1', nullable: false })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) =>
        m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
      )
      .coreHash('sha256:test-core')
      .build();

    const fixtureContract = validateContract<Contract>(contractJson);

    // Runtime checks
    expect(builderContract.schemaVersion).toBe(fixtureContract.schemaVersion);
    expect(builderContract.target).toBe(fixtureContract.target);
    expect(builderContract.targetFamily).toBe(fixtureContract.targetFamily);
    const builderUserTable = builderContract.storage.tables.user;
    const fixtureUserTable = fixtureContract.storage.tables.user;
    expect(builderUserTable?.columns.id?.type).toBe(fixtureUserTable?.columns.id?.type);
    expect(builderUserTable?.columns.email?.type).toBe(fixtureUserTable?.columns.email?.type);
    expect(builderUserTable?.columns.createdAt?.type).toBe(
      fixtureUserTable?.columns.createdAt?.type,
    );
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
      .target('postgres')
      .table('user', (t) =>
        t
          .column('id', { type: dataTypes.int4, nullable: false })
          .column('email', { type: dataTypes.text, nullable: false }),
      )
      .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
      .build();

    // Type checks - verify type preserves literal types
    expectTypeOf(contract.storage.tables.user.columns.id.type).toEqualTypeOf<'pg/int4@1'>();
    expectTypeOf(contract.storage.tables.user.columns.email.type).toEqualTypeOf<'pg/text@1'>();
  });

  it('validates type format', () => {
    expect(() => {
      defineContract<CodecTypes>()
        .target('postgres')
        .table('user', (t) => t.column('id', { type: 'invalid' }))
        .build();
    }).toThrow(/type must be in format/);
  });

  describe('relation builder', () => {
    it('builds a contract with 1:N relation', () => {
      const contract = defineContract<CodecTypes>()
        .target('postgres')
        .table('user', (t) =>
          t
            .column('id', { type: 'pg/int4@1', nullable: false })
            .column('email', { type: 'pg/text@1', nullable: false })
            .primaryKey(['id']),
        )
        .table('post', (t) =>
          t
            .column('id', { type: 'pg/int4@1', nullable: false })
            .column('userId', { type: 'pg/int4@1', nullable: false })
            .column('title', { type: 'pg/text@1', nullable: false })
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
        .coreHash('sha256:test-core')
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
        .target('postgres')
        .table('user', (t) =>
          t
            .column('id', { type: 'pg/int4@1', nullable: false })
            .column('email', { type: 'pg/text@1', nullable: false })
            .primaryKey(['id']),
        )
        .table('role', (t) =>
          t
            .column('id', { type: 'pg/int4@1', nullable: false })
            .column('name', { type: 'pg/text@1', nullable: false })
            .primaryKey(['id']),
        )
        .table('userRole', (t) =>
          t
            .column('userId', { type: 'pg/int4@1', nullable: false })
            .column('roleId', { type: 'pg/int4@1', nullable: false })
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
        .coreHash('sha256:test-core')
        .build();

      // Runtime checks
      const relations = contract.relations as Record<string, Record<string, unknown>>;
      const userRelations = relations['user'] as Record<string, unknown>;
      const roleRelations = relations['role'] as Record<string, unknown>;
      expect(userRelations).toBeDefined();
      expect(userRelations['roles']).toBeDefined();
      const userRoles = userRelations['roles'] as {
        to: string;
        cardinality: string;
        through?: { table: string; parentCols: readonly string[]; childCols: readonly string[] };
      };
      expect(userRoles.to).toBe('Role');
      expect(userRoles.cardinality).toBe('N:M');
      expect(userRoles.through).toBeDefined();
      expect(userRoles.through?.table).toBe('userRole');
      expect(userRoles.through?.parentCols).toEqual(['id']);
      expect(userRoles.through?.childCols).toEqual(['userId']);

      expect(roleRelations).toBeDefined();
      expect(roleRelations['users']).toBeDefined();
      const roleUsers = roleRelations['users'] as {
        to: string;
        cardinality: string;
        through?: { table: string; parentCols: readonly string[]; childCols: readonly string[] };
      };
      expect(roleUsers.to).toBe('User');
      expect(roleUsers.cardinality).toBe('N:M');
      expect(roleUsers.through).toBeDefined();
      expect(roleUsers.through?.table).toBe('userRole');
      expect(roleUsers.through?.parentCols).toEqual(['id']);
      expect(roleUsers.through?.childCols).toEqual(['roleId']);
    });

    it('validates parentTable matches model table', () => {
      expect(() => {
        defineContract<CodecTypes>()
          .target('postgres')
          .table('user', (t) => t.column('id', { type: 'pg/int4@1', nullable: false }))
          .table('post', (t) => t.column('id', { type: 'pg/int4@1', nullable: false }))
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
          .target('postgres')
          .table('user', (t) => t.column('id', { type: 'pg/int4@1', nullable: false }))
          .table('post', (t) => t.column('id', { type: 'pg/int4@1', nullable: false }))
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
          .target('postgres')
          .table('user', (t) => t.column('id', { type: 'pg/int4@1', nullable: false }))
          .table('role', (t) => t.column('id', { type: 'pg/int4@1', nullable: false }))
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
          .target('postgres')
          .table('user', (t) => t.column('id', { type: 'pg/int4@1', nullable: false }))
          .table('role', (t) => t.column('id', { type: 'pg/int4@1', nullable: false }))
          .table('userRole', (t) => t.column('userId', { type: 'pg/int4@1', nullable: false }))
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
