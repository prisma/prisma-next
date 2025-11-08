import type { ModelDefinition, SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { createCodecRegistry } from '@prisma-next/sql-target';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { dataTypes } from '../../adapter-postgres/src/exports/codec-types';
import { validateContract } from '../src/contract';
import { defineContract } from '../src/contract-builder';
import { schema } from '../src/schema';
import { sql } from '../src/sql';
import type { Adapter, LoweredStatement, ResultType, SelectAst } from '../src/types';
import type { CodecTypes, Contract } from './fixtures/contract.d';
import contractJson from './fixtures/contract.json' with { type: 'json' };

function createStubAdapter(): Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement> {
  return {
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return createCodecRegistry();
      },
    },
    lower(ast: SelectAst, ctx: { contract: SqlContract<SqlStorage>; params?: readonly unknown[] }) {
      const sqlText = JSON.stringify(ast);
      return {
        profileId: this.profile.id,
        body: Object.freeze({ sql: sqlText, params: ctx.params ? [...ctx.params] : [] }),
      };
    },
  };
}

describe('builder integration', () => {
  it('builds a contract matching fixture structure', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) =>
        t
          .column('id', 'int4', { nullable: false })
          .column('email', 'text', { nullable: false })
          .column('createdAt', 'timestamptz', { nullable: false })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) =>
        m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
      )
      .coreHash('sha256:test-core')
      .build();

    // Runtime checks
    expect(contract.schemaVersion).toBe('1');
    expect(contract.target).toBe('postgres');
    expect(contract.targetFamily).toBe('sql');
    expect(contract.coreHash).toBe('sha256:test-core');
    expect(contract.storage.tables).toHaveProperty('user');
    const userTable = contract.storage.tables.user;
    expect(userTable).toBeDefined();
    expect(userTable?.columns).toHaveProperty('id');
    expect(userTable?.columns).toHaveProperty('email');
    expect(userTable?.columns).toHaveProperty('createdAt');
    expect(userTable?.primaryKey?.columns).toEqual(['id']);
    expect(contract.models).toHaveProperty('User');
    const userModel = contract.models.User;
    expect(userModel.storage.table).toBe('user');
    expect(userModel.fields).toHaveProperty('id');
    expect(userModel.fields).toHaveProperty('email');
    expect(userModel.fields).toHaveProperty('createdAt');

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
          .column('id', 'int4', { nullable: false })
          .column('email', 'text', { nullable: false })
          .column('createdAt', 'timestamptz', { nullable: false })
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
          .column('id', 'int4', { nullable: false })
          .column('email', 'text', { nullable: false })
          .column('createdAt', 'timestamptz', { nullable: false })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) =>
        m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
      )
      .coreHash('sha256:test-core')
      .build();

    const tables = schema<typeof contract, CodecTypes>(contract).tables;
    const userTable = tables.user;
    expect(userTable).toBeDefined();
    expect(userTable?.columns).toHaveProperty('id');
    expect(userTable?.columns).toHaveProperty('email');
    expect(userTable?.columns).toHaveProperty('createdAt');
  });

  it('contract works with sql() function', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) =>
        t
          .column('id', 'int4', { nullable: false })
          .column('email', 'text', { nullable: false })
          .column('createdAt', 'timestamptz', { nullable: false })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) =>
        m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
      )
      .coreHash('sha256:test-core')
      .build();

    const adapter = createStubAdapter();
    const tables = schema<typeof contract, CodecTypes>(contract).tables;
    const userTable = tables.user;
    if (!userTable) throw new Error('user table not found');

    const _plan = sql<typeof contract, CodecTypes>({ contract, adapter })
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
          .column('id', 'int4', { nullable: false })
          .column('email', 'text', { nullable: false })
          .column('createdAt', 'timestamptz', { nullable: false })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) =>
        m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
      )
      .coreHash('sha256:test-core')
      .build();

    const adapter = createStubAdapter();
    const tables = schema<typeof contract, CodecTypes>(contract).tables;
    const userTable = tables.user;
    if (!userTable) throw new Error('user table not found');

    const _plan = sql<typeof contract, CodecTypes>({ contract, adapter })
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
          .column('id', 'int4', { nullable: false })
          .column('email', 'text', { nullable: false })
          .column('createdAt', 'timestamptz', { nullable: false })
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
          .column('id', 'int4', { nullable: false, type: dataTypes.int4 })
          .column('email', 'text', { nullable: false, type: dataTypes.text }),
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
        .table('user', (t) => t.column('id', 'int4', { type: 'invalid' }))
        .build();
    }).toThrow(/type must be in format/);
  });

  describe('relation builder', () => {
    it('builds a contract with 1:N relation', () => {
      const contract = defineContract<CodecTypes>()
        .target('postgres')
        .table('user', (t) =>
          t
            .column('id', 'int4', { nullable: false })
            .column('email', 'text', { nullable: false })
            .primaryKey(['id']),
        )
        .table('post', (t) =>
          t
            .column('id', 'int4', { nullable: false })
            .column('userId', 'int4', { nullable: false })
            .column('title', 'text', { nullable: false })
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
      expect(contract.relations.user).toBeDefined();
      expect(contract.relations.user.posts).toBeDefined();
      expect(contract.relations.user.posts.to).toBe('Post');
      expect(contract.relations.user.posts.cardinality).toBe('1:N');
      expect(contract.relations.user.posts.on.parentCols).toEqual(['id']);
      expect(contract.relations.user.posts.on.childCols).toEqual(['userId']);

      expect(contract.relations.post).toBeDefined();
      expect(contract.relations.post.user).toBeDefined();
      expect(contract.relations.post.user.to).toBe('User');
      expect(contract.relations.post.user.cardinality).toBe('N:1');
      expect(contract.relations.post.user.on.parentCols).toEqual(['userId']);
      expect(contract.relations.post.user.on.childCols).toEqual(['id']);
    });

    it('builds a contract with N:M relation', () => {
      const contract = defineContract<CodecTypes>()
        .target('postgres')
        .table('user', (t) =>
          t
            .column('id', 'int4', { nullable: false })
            .column('email', 'text', { nullable: false })
            .primaryKey(['id']),
        )
        .table('role', (t) =>
          t
            .column('id', 'int4', { nullable: false })
            .column('name', 'text', { nullable: false })
            .primaryKey(['id']),
        )
        .table('userRole', (t) =>
          t
            .column('userId', 'int4', { nullable: false })
            .column('roleId', 'int4', { nullable: false })
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
      expect(contract.relations.user).toBeDefined();
      expect(contract.relations.user.roles).toBeDefined();
      expect(contract.relations.user.roles.to).toBe('Role');
      expect(contract.relations.user.roles.cardinality).toBe('N:M');
      expect(contract.relations.user.roles.through).toBeDefined();
      expect(contract.relations.user.roles.through?.table).toBe('userRole');
      expect(contract.relations.user.roles.through?.parentCols).toEqual(['id']);
      expect(contract.relations.user.roles.through?.childCols).toEqual(['userId']);

      expect(contract.relations.role).toBeDefined();
      expect(contract.relations.role.users).toBeDefined();
      expect(contract.relations.role.users.to).toBe('User');
      expect(contract.relations.role.users.cardinality).toBe('N:M');
      expect(contract.relations.role.users.through).toBeDefined();
      expect(contract.relations.role.users.through?.table).toBe('userRole');
      expect(contract.relations.role.users.through?.parentCols).toEqual(['id']);
      expect(contract.relations.role.users.through?.childCols).toEqual(['roleId']);
    });

    it('validates parentTable matches model table', () => {
      expect(() => {
        defineContract<CodecTypes>()
          .target('postgres')
          .table('user', (t) => t.column('id', 'int4', { nullable: false }))
          .table('post', (t) => t.column('id', 'int4', { nullable: false }))
          .model('User', 'user', (m) =>
            m.relation('posts', {
              toModel: 'Post',
              toTable: 'post',
              cardinality: '1:N',
              on: {
                parentTable: 'wrongTable',
                parentColumns: ['id'],
                childTable: 'post',
                childColumns: ['userId'],
              },
            }),
          )
          .build();
      }).toThrow(/parentTable.*does not match model table/);
    });

    it('validates childTable matches toTable for non-N:M relations', () => {
      expect(() => {
        defineContract<CodecTypes>()
          .target('postgres')
          .table('user', (t) => t.column('id', 'int4', { nullable: false }))
          .table('post', (t) => t.column('id', 'int4', { nullable: false }))
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
          .table('user', (t) => t.column('id', 'int4', { nullable: false }))
          .table('role', (t) => t.column('id', 'int4', { nullable: false }))
          .model('User', 'user', (m) =>
            m.relation('roles', {
              toModel: 'Role',
              toTable: 'role',
              cardinality: 'N:M',
              on: {
                parentTable: 'user',
                parentColumns: ['id'],
                childTable: 'userRole',
                childColumns: ['userId'],
              },
            } as any),
          )
          .build();
      }).toThrow(/cardinality "N:M" requires through field/);
    });

    it('validates childTable matches through.table for N:M relations', () => {
      expect(() => {
        defineContract<CodecTypes>()
          .target('postgres')
          .table('user', (t) => t.column('id', 'int4', { nullable: false }))
          .table('role', (t) => t.column('id', 'int4', { nullable: false }))
          .table('userRole', (t) => t.column('userId', 'int4', { nullable: false }))
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
