import type { FamilyPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import { describe, expect, it } from 'vitest';
import { type ContractInput, defineContract, field, model, rel } from '../src/contract-builder';
import { columnDescriptor } from './helpers/column-descriptor';

const int4Column = columnDescriptor('pg/int4@1');
const textColumn = columnDescriptor('pg/text@1');

const bareFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

function defineTestContract<
  const Types extends NonNullable<ContractInput['types']> = Record<never, never>,
  const Models extends NonNullable<ContractInput['models']> = Record<never, never>,
  const ExtensionPacks extends NonNullable<ContractInput['extensionPacks']> | undefined = undefined,
  const Capabilities extends NonNullable<ContractInput['capabilities']> | undefined = undefined,
>(
  definition: Omit<
    ContractInput<
      typeof bareFamilyPack,
      typeof postgresTargetPack,
      Types,
      Models,
      ExtensionPacks,
      Capabilities
    >,
    'family' | 'target'
  >,
) {
  return defineContract({
    family: bareFamilyPack,
    target: postgresTargetPack,
    ...definition,
  });
}

function buildUserModel() {
  return model('User', {
    fields: {
      id: field.column(int4Column).id(),
      email: field.column(textColumn),
    },
  }).sql({ table: 'user' });
}

function buildPostModel(
  User: ReturnType<typeof buildUserModel>,
  fkOptions?: {
    readonly name?: string;
    readonly onDelete?: 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';
    readonly onUpdate?: 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';
    readonly constraint?: boolean;
    readonly index?: boolean;
  },
) {
  return model('Post', {
    fields: {
      id: field.column(int4Column).id(),
      userId: field.column(int4Column),
    },
    relations: {
      user: rel.belongsTo(User, { from: 'userId', to: 'id' }).sql({ fk: fkOptions ?? {} }),
    },
  }).sql({ table: 'post' });
}

describe('contract definition constraint support', () => {
  it('emits unique constraints in the contract', () => {
    const contract = defineTestContract({
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn).unique(),
          },
        }).sql({ table: 'user' }),
      },
    });

    expect(contract.storage.tables.user.uniques).toHaveLength(1);
    expect(contract.storage.tables.user.uniques[0]).toEqual({ columns: ['email'] });
  });

  it('emits unique constraints with names in the contract', () => {
    const contract = defineTestContract({
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn).unique({ name: 'user_email_unique' }),
          },
        }).sql({ table: 'user' }),
      },
    });

    expect(contract.storage.tables.user.uniques).toHaveLength(1);
    expect(contract.storage.tables.user.uniques[0]).toEqual({
      columns: ['email'],
      name: 'user_email_unique',
    });
  });

  it('emits indexes in the contract', () => {
    const contract = defineTestContract({
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'user',
          indexes: [constraints.index(cols.email)],
        })),
      },
    });

    expect(contract.storage.tables.user.indexes).toHaveLength(1);
    expect(contract.storage.tables.user.indexes[0]).toEqual({ columns: ['email'] });
  });

  it('emits indexes with names in the contract', () => {
    const contract = defineTestContract({
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'user',
          indexes: [constraints.index(cols.email, { name: 'user_email_idx' })],
        })),
      },
    });

    expect(contract.storage.tables.user.indexes).toHaveLength(1);
    expect(contract.storage.tables.user.indexes[0]).toEqual({
      columns: ['email'],
      name: 'user_email_idx',
    });
  });

  it('emits foreign keys in the contract', () => {
    const User = buildUserModel();
    const Post = buildPostModel(User);
    const contract = defineTestContract({
      models: { User, Post },
    });

    expect(contract.storage.tables.post.foreignKeys).toHaveLength(1);
    expect(contract.storage.tables.post.foreignKeys[0]).toEqual({
      columns: ['userId'],
      references: { table: 'user', columns: ['id'] },
      constraint: true,
      index: true,
    });
  });

  it('emits foreign keys with names in the contract', () => {
    const User = buildUserModel();
    const Post = buildPostModel(User, { name: 'post_userId_fkey' });
    const contract = defineTestContract({
      models: { User, Post },
    });

    expect(contract.storage.tables.post.foreignKeys).toHaveLength(1);
    expect(contract.storage.tables.post.foreignKeys[0]).toEqual({
      columns: ['userId'],
      references: { table: 'user', columns: ['id'] },
      constraint: true,
      index: true,
      name: 'post_userId_fkey',
    });
  });

  it('emits primary key without name when not provided', () => {
    const contract = defineTestContract({
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
          },
        }).sql({ table: 'user' }),
      },
    });

    expect(contract.storage.tables.user.primaryKey).toEqual({
      columns: ['id'],
    });
    expect(contract.storage.tables.user.primaryKey).not.toHaveProperty('name');
  });

  it('emits primary key name in the contract', () => {
    const contract = defineTestContract({
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id({ name: 'user_pkey' }),
          },
        }).sql({ table: 'user' }),
      },
    });

    expect(contract.storage.tables.user.primaryKey).toEqual({
      columns: ['id'],
      name: 'user_pkey',
    });
  });

  it('rejects duplicate named storage objects during build', () => {
    expect(() =>
      defineTestContract({
        models: {
          User: model('User', {
            fields: {
              id: field.column(int4Column).id({ name: 'user_pkey' }),
            },
          }).sql(({ cols, constraints }) => ({
            table: 'user',
            indexes: [constraints.index(cols.id, { name: 'user_pkey' })],
          })),
        },
      }),
    ).toThrow(/Contract semantic validation failed:.*user_pkey/);
  });

  it('supports multiple constraints on the same table', () => {
    const contract = defineTestContract({
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn).unique(),
            username: field.column(textColumn).unique(),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'user',
          indexes: [constraints.index(cols.email), constraints.index(cols.username)],
        })),
      },
    });

    expect(contract.storage.tables.user.uniques).toHaveLength(2);
    expect(contract.storage.tables.user.indexes).toHaveLength(2);
  });

  it('defaults per-FK constraint=true, index=true', () => {
    const User = buildUserModel();
    const Post = buildPostModel(User);
    const contract = defineTestContract({
      models: { User, Post },
    });

    expect(contract.storage.tables.post.foreignKeys[0]).toEqual({
      columns: ['userId'],
      references: { table: 'user', columns: ['id'] },
      constraint: true,
      index: true,
    });
  });

  it('materializes foreignKeyDefaults into per-FK fields', () => {
    const User = buildUserModel();
    const Post = buildPostModel(User);
    const contract = defineTestContract({
      foreignKeyDefaults: { constraint: false, index: true },
      models: { User, Post },
    });

    expect(contract.storage.tables.post.foreignKeys[0]).toEqual({
      columns: ['userId'],
      references: { table: 'user', columns: ['id'] },
      constraint: false,
      index: true,
    });
  });

  it('per-FK override takes precedence over foreignKeyDefaults', () => {
    const User = buildUserModel();
    const Post = buildPostModel(User, { constraint: true, index: false });
    const contract = defineTestContract({
      foreignKeyDefaults: { constraint: false, index: false },
      models: { User, Post },
    });

    expect(contract.storage.tables.post.foreignKeys[0]).toEqual({
      columns: ['userId'],
      references: { table: 'user', columns: ['id'] },
      constraint: true,
      index: false,
    });
  });

  it('supports compound ids and uniques through attributes', () => {
    const contract = defineTestContract({
      models: {
        Membership: model('Membership', {
          fields: {
            orgId: field.column(textColumn),
            userId: field.column(textColumn),
            role: field.column(textColumn),
          },
        })
          .attributes(({ fields, constraints }) => ({
            id: constraints.id([fields.orgId, fields.userId], { name: 'membership_pkey' }),
            uniques: [
              constraints.unique([fields.orgId, fields.role], {
                name: 'membership_org_role_key',
              }),
            ],
          }))
          .sql({ table: 'membership' }),
      },
    });

    expect(contract.storage.tables.membership.primaryKey).toEqual({
      columns: ['orgId', 'userId'],
      name: 'membership_pkey',
    });
    expect(contract.storage.tables.membership.uniques).toEqual([
      {
        columns: ['orgId', 'role'],
        name: 'membership_org_role_key',
      },
    ]);
  });
});
