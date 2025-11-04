import { describe, expect, it, expectTypeOf } from 'vitest';
import { defineContract } from '../src/contract-builder';
import { validateContract } from '../src/contract';
import { schema } from '../src/schema';
import { sql } from '../src/sql';
import type { SqlContract, SqlStorage, ModelDefinition } from '../src/contract-types';
import type { Adapter, LoweredStatement, SelectAst, ResultType } from '../src/types';
import { CodecRegistry } from '@prisma-next/sql-target';
import type { CodecTypes } from './fixtures/contract.d';
import contractJson from './fixtures/contract.json' assert { type: 'json' };
import type { Contract } from './fixtures/contract.d';

function createStubAdapter(): Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement> {
  return {
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return new CodecRegistry();
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
    const userTable = contract.storage.tables['user'];
    expect(userTable).toBeDefined();
    expect(userTable?.columns).toHaveProperty('id');
    expect(userTable?.columns).toHaveProperty('email');
    expect(userTable?.columns).toHaveProperty('createdAt');
    expect(userTable?.primaryKey?.columns).toEqual(['id']);
    expect(contract.models).toHaveProperty('User');
    const userModel = contract.models['User'];
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
    type TableKeys = keyof typeof contract.storage.tables;
    // This will fail if types are generic (string) instead of literal ('user')
    const _tableKeysCheck: TableKeys extends 'user' ? true : false =
      true as TableKeys extends 'user' ? true : false;
    expectTypeOf(_tableKeysCheck).toEqualTypeOf<true>();

    // Verify column names are literal types
    const userTableType = contract.storage.tables['user'];
    expectTypeOf(userTableType.columns).toHaveProperty('id');
    expectTypeOf(userTableType.columns).toHaveProperty('email');
    expectTypeOf(userTableType.columns).toHaveProperty('createdAt');
    type ColumnKeys = keyof typeof userTableType.columns;
    // This will fail if types are generic (string) instead of literal union
    const _columnKeysCheck: ColumnKeys extends 'id' | 'email' | 'createdAt' ? true : false =
      true as ColumnKeys extends 'id' | 'email' | 'createdAt' ? true : false;
    expectTypeOf(_columnKeysCheck).toEqualTypeOf<true>();

    // Verify column types are literal (canonicalized)
    expectTypeOf(userTableType.columns['id']['type']).toEqualTypeOf<'pg/int4@1'>();
    expectTypeOf(userTableType.columns['email']['type']).toEqualTypeOf<'pg/text@1'>();
    expectTypeOf(userTableType.columns['createdAt']['type']).toEqualTypeOf<'pg/timestamptz@1'>();

    // Verify nullable is literal false, not boolean
    expectTypeOf(userTableType.columns['id']['nullable']).toEqualTypeOf<false>();
    expectTypeOf(userTableType.columns['email']['nullable']).toEqualTypeOf<false>();
    expectTypeOf(userTableType.columns['createdAt']['nullable']).toEqualTypeOf<false>();

    // Verify model name is literal 'User', not string
    expectTypeOf(contract.models).toHaveProperty('User');
    type ModelKeys = keyof typeof contract.models;
    // This will fail if types are generic (string) instead of literal ('User')
    const _modelKeysCheck: ModelKeys extends 'User' ? true : false =
      true as ModelKeys extends 'User' ? true : false;
    expectTypeOf(_modelKeysCheck).toEqualTypeOf<true>();

    // Verify model storage table is literal 'user'
    expectTypeOf(contract.models['User']['storage']['table']).toEqualTypeOf<'user'>();

    // Verify model field names are literal types
    expectTypeOf(contract.models['User']['fields']).toHaveProperty('id');
    expectTypeOf(contract.models['User']['fields']).toHaveProperty('email');
    expectTypeOf(contract.models['User']['fields']).toHaveProperty('createdAt');
    type FieldKeys = keyof (typeof contract.models)['User']['fields'];
    // This will fail if types are generic (string) instead of literal union
    const _fieldKeysCheck: FieldKeys extends 'id' | 'email' | 'createdAt' ? true : false =
      true as FieldKeys extends 'id' | 'email' | 'createdAt' ? true : false;
    expectTypeOf(_fieldKeysCheck).toEqualTypeOf<true>();
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

    const validated = validateContract<SqlContract<SqlStorage>>(contract);
    expect(validated.target).toBe('postgres');
    expect(validated.storage.tables['user']).toBeDefined();
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

    const validated = validateContract<SqlContract<SqlStorage>>(contract);
    const tables = schema<typeof validated, CodecTypes>(validated).tables;
    const userTable = tables['user'];
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

    const validated = validateContract<SqlContract<SqlStorage>>(contract);
    const adapter = createStubAdapter();
    const tables = schema<typeof validated, CodecTypes>(validated).tables;
    const userTable = tables['user'];
    if (!userTable) throw new Error('user table not found');

    const plan = sql<typeof validated, CodecTypes>({ contract: validated, adapter })
      .from(userTable)
      .select({
        id: userTable.columns['id']!,
        email: userTable.columns['email']!,
      })
      .build();

    // Runtime checks
    expect(plan.ast).toBeDefined();
    expect(plan.ast?.kind).toBe('select');
    expect(plan.meta.coreHash).toBe('sha256:test-core');

    // Type checks - verify plan types are specific
    expectTypeOf(plan.meta.coreHash).toEqualTypeOf<string>();
    // Note: plan.ast type checking is complex due to plan structure
    // We verify it exists at runtime above

    // Verify ResultType inference works with specific types
    type Row = ResultType<typeof plan>;
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

    const validated = validateContract<SqlContract<SqlStorage>>(contract);
    const adapter = createStubAdapter();
    const tables = schema<typeof validated, CodecTypes>(validated).tables;
    const userTable = tables['user'];
    if (!userTable) throw new Error('user table not found');

    const plan = sql<typeof validated, CodecTypes>({ contract: validated, adapter })
      .from(userTable)
      .select({
        id: userTable.columns['id']!,
        email: userTable.columns['email']!,
        createdAt: userTable.columns['createdAt']!,
      })
      .build();

    type Row = ResultType<typeof plan>;

    // Runtime check
    const _row: Row = {
      id: 1,
      email: 'test@example.com',
      createdAt: '2024-01-01T00:00:00Z',
    };
    expect(_row).toBeDefined();

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

    const validatedBuilderContract = validateContract<SqlContract<SqlStorage>>(builderContract);
    const fixtureContract = validateContract<Contract>(contractJson);

    // Runtime checks
    expect(validatedBuilderContract.schemaVersion).toBe(fixtureContract.schemaVersion);
    expect(validatedBuilderContract.target).toBe(fixtureContract.target);
    expect(validatedBuilderContract.targetFamily).toBe(fixtureContract.targetFamily);
    const builderUserTable = validatedBuilderContract.storage.tables['user'];
    const fixtureUserTable = fixtureContract.storage.tables['user'];
    expect(builderUserTable?.columns['id']?.type).toBe(fixtureUserTable?.columns['id']?.type);
    expect(builderUserTable?.columns['email']?.type).toBe(fixtureUserTable?.columns['email']?.type);
    expect(builderUserTable?.columns['createdAt']?.type).toBe(
      fixtureUserTable?.columns['createdAt']?.type,
    );
    const builderUserModel = validatedBuilderContract.models['User'] as unknown as ModelDefinition;
    const fixtureUserModel = fixtureContract.models['User'] as unknown as ModelDefinition;
    expect(builderUserModel.storage.table).toBe(fixtureUserModel.storage.table);
    expect(Object.keys(builderUserModel.fields)).toEqual(Object.keys(fixtureUserModel.fields));

    // Type checks - verify builder contract preserves types like fixture
    expectTypeOf(validatedBuilderContract.target).toEqualTypeOf<'postgres'>();
    expectTypeOf(validatedBuilderContract.targetFamily).toEqualTypeOf<'sql'>();
    expectTypeOf(validatedBuilderContract.schemaVersion).toEqualTypeOf<'1'>();

    // Verify table and column types match
    expectTypeOf(validatedBuilderContract.storage.tables).toHaveProperty('user');
    expectTypeOf(validatedBuilderContract.storage.tables['user']['columns']).toHaveProperty('id');
    expectTypeOf(validatedBuilderContract.storage.tables['user']['columns']).toHaveProperty(
      'email',
    );
    expectTypeOf(validatedBuilderContract.storage.tables['user']['columns']).toHaveProperty(
      'createdAt',
    );

    // Verify model types match
    expectTypeOf(validatedBuilderContract.models).toHaveProperty('User');
    expectTypeOf(
      validatedBuilderContract.models['User']['storage']['table'],
    ).toEqualTypeOf<'user'>();
    expectTypeOf(validatedBuilderContract.models['User']['fields']).toHaveProperty('id');
    expectTypeOf(validatedBuilderContract.models['User']['fields']).toHaveProperty('email');
    expectTypeOf(validatedBuilderContract.models['User']['fields']).toHaveProperty('createdAt');
  });

  it('supports typeId decorations', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) =>
        t
          .column('id', 'int4', { nullable: false, typeId: 'pg/int4@1' })
          .column('email', 'text', { nullable: false, typeId: 'pg/text@1' }),
      )
      .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
      .build();

    // Runtime checks
    expect(contract.extensions).toBeDefined();
    expect(contract.extensions?.['core']).toBeDefined();
    const coreExt = contract.extensions?.['core'] as {
      decorations?: {
        columns?: Array<{
          ref: { kind: string; table: string; column: string };
          payload?: { typeId?: string };
        }>;
      };
    };
    expect(coreExt.decorations?.columns).toBeDefined();
    expect(coreExt.decorations?.columns?.length).toBe(2);
    expect(coreExt.decorations?.columns?.[0]?.payload?.typeId).toBe('pg/int4@1');
    expect(coreExt.decorations?.columns?.[1]?.payload?.typeId).toBe('pg/text@1');

    // Type checks - verify typeId preserves literal types
    expectTypeOf(
      contract.storage.tables['user']['columns']['id']['type'],
    ).toEqualTypeOf<'pg/int4@1'>();
    expectTypeOf(
      contract.storage.tables['user']['columns']['email']['type'],
    ).toEqualTypeOf<'pg/text@1'>();
  });

  it('validates typeId format', () => {
    expect(() => {
      defineContract<CodecTypes>()
        .target('postgres')
        .table('user', (t) => t.column('id', 'int4', { typeId: 'invalid' }))
        .build();
    }).toThrow(/typeId must be in format/);
  });
});
