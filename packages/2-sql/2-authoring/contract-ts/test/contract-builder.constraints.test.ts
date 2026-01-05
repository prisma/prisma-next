import type { TargetPackRef } from '@prisma-next/contract/framework-components';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/contract-builder';
import type { CodecTypes } from './fixtures/contract.d';
import { columnDescriptor } from './helpers/column-descriptor';

const int4Column = columnDescriptor('pg/int4@1');
const textColumn = columnDescriptor('pg/text@1');

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

describe('contract builder constraint support', () => {
  it('emits unique constraints in the contract', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) =>
        t
          .column('id', { type: int4Column })
          .column('email', { type: textColumn })
          .primaryKey(['id'])
          .unique(['email']),
      )
      .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
      .build();

    expect(contract.storage.tables.user.uniques).toHaveLength(1);
    expect(contract.storage.tables.user.uniques[0]).toEqual({ columns: ['email'] });
  });

  it('emits unique constraints with names in the contract', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) =>
        t
          .column('id', { type: int4Column })
          .column('email', { type: textColumn })
          .primaryKey(['id'])
          .unique(['email'], 'user_email_unique'),
      )
      .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
      .build();

    expect(contract.storage.tables.user.uniques).toHaveLength(1);
    expect(contract.storage.tables.user.uniques[0]).toEqual({
      columns: ['email'],
      name: 'user_email_unique',
    });
  });

  it('emits indexes in the contract', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) =>
        t
          .column('id', { type: int4Column })
          .column('email', { type: textColumn })
          .primaryKey(['id'])
          .index(['email']),
      )
      .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
      .build();

    expect(contract.storage.tables.user.indexes).toHaveLength(1);
    expect(contract.storage.tables.user.indexes[0]).toEqual({ columns: ['email'] });
  });

  it('emits indexes with names in the contract', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) =>
        t
          .column('id', { type: int4Column })
          .column('email', { type: textColumn })
          .primaryKey(['id'])
          .index(['email'], 'user_email_idx'),
      )
      .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
      .build();

    expect(contract.storage.tables.user.indexes).toHaveLength(1);
    expect(contract.storage.tables.user.indexes[0]).toEqual({
      columns: ['email'],
      name: 'user_email_idx',
    });
  });

  it('emits foreign keys in the contract', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) => t.column('id', { type: int4Column }).primaryKey(['id']))
      .table('post', (t) =>
        t
          .column('id', { type: int4Column })
          .column('userId', { type: int4Column })
          .primaryKey(['id'])
          .foreignKey(['userId'], { table: 'user', columns: ['id'] }),
      )
      .model('User', 'user', (m) => m.field('id', 'id'))
      .model('Post', 'post', (m) => m.field('id', 'id').field('userId', 'userId'))
      .build();

    expect(contract.storage.tables.post.foreignKeys).toHaveLength(1);
    expect(contract.storage.tables.post.foreignKeys[0]).toEqual({
      columns: ['userId'],
      references: { table: 'user', columns: ['id'] },
    });
  });

  it('emits foreign keys with names in the contract', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) => t.column('id', { type: int4Column }).primaryKey(['id']))
      .table('post', (t) =>
        t
          .column('id', { type: int4Column })
          .column('userId', { type: int4Column })
          .primaryKey(['id'])
          .foreignKey(['userId'], { table: 'user', columns: ['id'] }, 'post_userId_fkey'),
      )
      .model('User', 'user', (m) => m.field('id', 'id'))
      .model('Post', 'post', (m) => m.field('id', 'id').field('userId', 'userId'))
      .build();

    expect(contract.storage.tables.post.foreignKeys).toHaveLength(1);
    expect(contract.storage.tables.post.foreignKeys[0]).toEqual({
      columns: ['userId'],
      references: { table: 'user', columns: ['id'] },
      name: 'post_userId_fkey',
    });
  });

  it('emits primary key name in the contract', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) => t.column('id', { type: int4Column }).primaryKey(['id'], 'user_pkey'))
      .model('User', 'user', (m) => m.field('id', 'id'))
      .build();

    expect(contract.storage.tables.user.primaryKey).toEqual({
      columns: ['id'],
      name: 'user_pkey',
    });
  });

  it('supports multiple constraints on the same table', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) =>
        t
          .column('id', { type: int4Column })
          .column('email', { type: textColumn })
          .column('username', { type: textColumn })
          .primaryKey(['id'])
          .unique(['email'])
          .unique(['username'])
          .index(['email'])
          .index(['username']),
      )
      .model('User', 'user', (m) =>
        m.field('id', 'id').field('email', 'email').field('username', 'username'),
      )
      .build();

    expect(contract.storage.tables.user.uniques).toHaveLength(2);
    expect(contract.storage.tables.user.indexes).toHaveLength(2);
  });
});
