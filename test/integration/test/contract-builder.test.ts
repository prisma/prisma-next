import {
  int4Column,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import { SqlContractSerializer } from '@prisma-next/family-sql/ir';
import sqlFamilyPack from '@prisma-next/family-sql/pack';
import type { ResultType } from '@prisma-next/framework-components/runtime';
import { sql } from '@prisma-next/sql-builder/runtime';
import type { ExtractCodecTypes } from '@prisma-next/sql-contract/types';
import { defineContract, field, model, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import { SelectAst } from '@prisma-next/sql-relational-core/ast';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import postgresPack from '@prisma-next/target-postgres/pack';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Contract } from './fixtures/contract.d';
import contractJson from './fixtures/contract.json' with { type: 'json' };

describe('builder integration', () => {
  it('builds a contract matching fixture structure', () => {
    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresPack,
      storageHash: 'sha256:test-core',
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
            createdAt: field.column(timestamptzColumn),
          },
        }).sql({ table: 'user' }),
      },
    });

    // Runtime checks
    expect(contract).toMatchObject({
      target: 'postgres',
      targetFamily: 'sql',
      storage: {
        storageHash: 'sha256:test-core',
        tables: expect.objectContaining({
          __unbound__: expect.objectContaining({
            user: expect.anything(),
          }),
        }),
      },
    });
    const userTable = contract.storage.tables['__unbound__']?.['user'];
    expect(userTable).toBeDefined();
    expect(userTable?.columns).toMatchObject({
      id: expect.anything(),
      email: expect.anything(),
      createdAt: expect.anything(),
    });
    expect(Object.keys(contract.storage.tables)).toEqual(['__unbound__']);
    type ContractCodecTypes = ExtractCodecTypes<typeof contract>;
    type IntCodecOutput = ContractCodecTypes['pg/int4@1']['output'];
    expectTypeOf<IntCodecOutput>().toEqualTypeOf<number>();
    type ColumnMeta =
      (typeof contract)['storage']['tables']['__unbound__']['user']['columns']['id'];
    expectTypeOf<ColumnMeta['codecId']>().toExtend<string>();
    expectTypeOf<ContractCodecTypes['pg/int4@1']['output']>().toEqualTypeOf<number>();

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

    // Verify tables are nested under __unbound__ namespace
    expect(contract.storage.tables['__unbound__']).toBeDefined();
    expect(contract.storage.tables['__unbound__']!['user']).toBeDefined();

    const userTableType = contract.storage.tables['__unbound__']!['user']!;
    expect(userTableType.columns['id']).toBeDefined();
    expect(userTableType.columns['email']).toBeDefined();
    expect(userTableType.columns['createdAt']).toBeDefined();

    expect(userTableType.columns['id']!.codecId).toBe('pg/int4@1');
    expect(userTableType.columns['email']!.codecId).toBe('pg/text@1');
    expect(userTableType.columns['createdAt']!.codecId).toBe('pg/timestamptz@1');

    expect(userTableType.columns['id']!.nullable).toBe(false);
    expect(userTableType.columns['email']!.nullable).toBe(false);
    expect(userTableType.columns['createdAt']!.nullable).toBe(false);

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

  it('contract can be validated via the SPI serializer', () => {
    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresPack,
      storageHash: 'sha256:test-core',
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
            createdAt: field.column(timestamptzColumn),
          },
        }).sql({ table: 'user' }),
      },
    });

    expect(contract.target).toBe('postgres');
    expect(contract.storage.tables['__unbound__']?.['user']).toBeDefined();
  });

  it('contract works with sql() function', () => {
    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresPack,
      storageHash: 'sha256:test-core',
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
            createdAt: field.column(timestamptzColumn),
          },
        }).sql({ table: 'user' }),
      },
    });

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);

    const db = sql<typeof contract>({ context });
    const plan = db.user.select('id', 'email').build();

    // Runtime checks
    expect(plan.ast).toBeInstanceOf(SelectAst);
    expect(plan.meta.storageHash).toBe(contract.storage.storageHash);

    // Type checks - verify plan types are specific
    expectTypeOf(plan.meta.storageHash).toEqualTypeOf<string>();

    // Verify ResultType inference works with specific types
    type Row = ResultType<typeof plan>;
    // Type inference may widen types, so we verify the codec outputs directly
    type ContractCodecTypes = ExtractCodecTypes<typeof contract>;
    expectTypeOf<ContractCodecTypes['pg/int4@1']['output']>().toEqualTypeOf<number>();
    expectTypeOf<ContractCodecTypes['pg/text@1']['output']>().toEqualTypeOf<string>();
    expectTypeOf<Row>().toHaveProperty('id');
    expectTypeOf<Row>().toHaveProperty('email');
  });

  it('ResultType inference works with builder contract', () => {
    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresPack,
      storageHash: 'sha256:test-core',
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
            createdAt: field.column(timestamptzColumn),
          },
        }).sql({ table: 'user' }),
      },
    });

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);

    const db = sql<typeof contract>({ context });
    const _plan = db.user.select('id', 'email', 'createdAt').build();

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
  });

  it('contract structure matches fixture contract', () => {
    const builderContract = defineContract({
      family: sqlFamilyPack,
      target: postgresPack,
      storageHash: 'sha256:test-core',
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
            createdAt: field.column(timestamptzColumn),
          },
        }).sql({ table: 'user' }),
      },
    });

    const fixtureContract = new SqlContractSerializer().deserializeContract(
      contractJson,
    ) as Contract;

    // Runtime checks
    expect(builderContract.target).toBe(fixtureContract.target);
    expect(builderContract.targetFamily).toBe(fixtureContract.targetFamily);
    expect(builderContract.storage.tables['__unbound__']!['user']!.columns).toMatchObject({
      id: { codecId: fixtureContract.storage.tables.__unbound__.user.columns.id.codecId },
      email: { codecId: fixtureContract.storage.tables.__unbound__.user.columns.email.codecId },
      createdAt: {
        codecId: fixtureContract.storage.tables.__unbound__.user.columns.createdAt.codecId,
      },
    });
    type ModelShape = {
      storage: { table: string; fields: Record<string, unknown> };
      fields: Record<string, unknown>;
    };
    const builderUserModel = builderContract.models.User as unknown as ModelShape;
    const fixtureUserModel = fixtureContract.models.User as unknown as ModelShape;
    expect(builderUserModel.storage.table).toBe(fixtureUserModel.storage.table);
    expect(Object.keys(builderUserModel.fields).sort()).toEqual(
      Object.keys(fixtureUserModel.fields).sort(),
    );

    // Type checks - verify builder contract preserves types like fixture
    expectTypeOf(builderContract.target).toEqualTypeOf<'postgres'>();
    expectTypeOf(builderContract.targetFamily).toEqualTypeOf<'sql'>();

    // Verify nested table structure
    expect(builderContract.storage.tables['__unbound__']!['user']).toBeDefined();
    const builderUserTable = builderContract.storage.tables['__unbound__']!['user']!;
    expect(builderUserTable.columns['id']).toBeDefined();
    expect(builderUserTable.columns['email']).toBeDefined();
    expect(builderUserTable.columns['createdAt']).toBeDefined();

    // Verify model types match
    expectTypeOf(builderContract.models).toHaveProperty('User');
    expectTypeOf(builderContract.models.User.storage.table).toEqualTypeOf<'user'>();
    expectTypeOf(builderContract.models.User.fields).toHaveProperty('id');
    expectTypeOf(builderContract.models.User.fields).toHaveProperty('email');
    expectTypeOf(builderContract.models.User.fields).toHaveProperty('createdAt');
  });

  it('supports type option with column-type constants', () => {
    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresPack,
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column),
            email: field.column(textColumn),
          },
        }).sql({ table: 'user' }),
      },
    });

    const userCols = contract.storage.tables['__unbound__']!['user']!.columns;
    expect(userCols).toMatchObject({
      id: { codecId: 'pg/int4@1' },
      email: { codecId: 'pg/text@1' },
    });
  });

  it('accepts any codecId format in descriptor (validation happens at runtime)', () => {
    // Column descriptors accept any codecId format - validation happens at runtime when the contract is used, not at build time
    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresPack,
      models: {
        User: model('User', {
          fields: {
            // biome-ignore lint/suspicious/noExplicitAny: Testing invalid type descriptor
            id: field.column({ codecId: 'invalid', nativeType: 'invalid' } as any),
          },
        }).sql({ table: 'user' }),
      },
    });
    // Contract builds successfully - invalid codecId will cause errors at runtime
    expect(contract.storage.tables['__unbound__']!['user']!.columns['id']!.codecId).toBe('invalid');
  });

  describe('relation builder', () => {
    it('builds a contract with 1:N relation', () => {
      const UserBase = model('User', {
        fields: {
          id: field.column(int4Column).id(),
          email: field.column(textColumn),
        },
      });

      const Post = model('Post', {
        fields: {
          id: field.column(int4Column).id(),
          userId: field.column(int4Column),
          title: field.column(textColumn),
        },
        relations: {
          user: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }),
        },
      }).sql({ table: 'post' });

      const User = UserBase.relations({
        posts: rel.hasMany(Post, { by: 'userId' }),
      }).sql({ table: 'user' });

      const contract = defineContract({
        family: sqlFamilyPack,
        target: postgresPack,
        storageHash: 'sha256:test-core',
        models: { User, Post },
      });

      type RelShape = {
        to: string;
        cardinality: string;
        on: { localFields: readonly string[]; targetFields: readonly string[] };
      };
      type ModelShape = { relations: Record<string, RelShape> };
      const models = contract.models as Record<string, ModelShape>;
      const userRels = models['User']!.relations;
      const postRels = models['Post']!.relations;
      expect(userRels).toBeDefined();
      expect(userRels['posts']).toBeDefined();
      expect(userRels['posts']!.to).toBe('Post');
      expect(userRels['posts']!.cardinality).toBe('1:N');
      expect(userRels['posts']!.on.localFields).toEqual(['id']);
      expect(userRels['posts']!.on.targetFields).toEqual(['userId']);

      expect(postRels).toBeDefined();
      expect(postRels['user']).toBeDefined();
      expect(postRels['user']!.to).toBe('User');
      expect(postRels['user']!.cardinality).toBe('N:1');
      expect(postRels['user']!.on.localFields).toEqual(['userId']);
      expect(postRels['user']!.on.targetFields).toEqual(['id']);
    });

    it('builds a contract with N:M relation', () => {
      const UserRole = model('UserRole', {
        fields: {
          userId: field.column(int4Column),
          roleId: field.column(int4Column),
        },
      })
        .attributes(({ fields, constraints }) => ({
          id: constraints.id([fields.userId, fields.roleId]),
        }))
        .sql({ table: 'userRole' });

      const UserBase = model('User', {
        fields: {
          id: field.column(int4Column).id(),
          email: field.column(textColumn),
        },
      });

      const Role = model('Role', {
        fields: {
          id: field.column(int4Column).id(),
          name: field.column(textColumn),
        },
        relations: {
          users: rel.manyToMany(UserBase, {
            through: () => UserRole,
            from: 'roleId',
            to: 'userId',
          }),
        },
      }).sql({ table: 'role' });

      const User = UserBase.relations({
        roles: rel.manyToMany(() => Role, {
          through: () => UserRole,
          from: 'userId',
          to: 'roleId',
        }),
      }).sql({ table: 'user' });

      const contract = defineContract({
        family: sqlFamilyPack,
        target: postgresPack,
        storageHash: 'sha256:test-core',
        models: { User, Role, UserRole },
      });

      const models = contract.models as Record<string, { relations: Record<string, unknown> }>;
      expect(models['User']?.relations).toMatchObject({
        roles: {
          to: 'Role',
          cardinality: 'N:M',
        },
      });
      expect(models['Role']?.relations).toMatchObject({
        users: {
          to: 'User',
          cardinality: 'N:M',
        },
      });
    });

    // TODO: The following 4 validation tests tested legacy chain builder validation logic (parentTable/childTable/through matching). In the new DSL, these constraints are enforced structurally by rel.belongsTo/hasMany/manyToMany and cannot be violated. Equivalent DSL validation tests exist in contract-builder.dsl.test.ts (e.g., "rejects belongsTo relations whose field arity does not match the target", "rejects hasMany
    // relations whose child fields do not match the parent identity arity", "rejects many-to-many relations whose through mappings do not match anchor arity").
  });
});
