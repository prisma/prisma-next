import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/contract-builder';
import type { CodecTypes } from './fixtures/contract.d';

describe('contract builder methods', () => {
  it('throws when building without target', () => {
    const builder = defineContract<CodecTypes>();
    expect(() => builder.build()).toThrow('target is required');
  });

  it('sets target correctly', () => {
    const contract = defineContract<CodecTypes>().target('postgres').build();
    expect(contract.target).toBe('postgres');
  });

  it('sets extensions correctly', () => {
    const extensions = { pack: { config: true } };
    const contract = defineContract<CodecTypes>().target('postgres').extensions(extensions).build();
    expect(contract.extensions).toEqual(extensions);
  });

  it('sets capabilities correctly', () => {
    const capabilities = { feature: { enabled: true } };
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .capabilities(capabilities)
      .build();
    expect(contract.capabilities).toEqual(capabilities);
  });

  it('sets coreHash correctly', () => {
    const hash = 'sha256:custom-hash';
    const contract = defineContract<CodecTypes>().target('postgres').coreHash(hash).build();
    expect(contract.coreHash).toBe(hash);
  });

  it('uses default coreHash when not provided', () => {
    const contract = defineContract<CodecTypes>().target('postgres').build();
    expect(contract.coreHash).toBe('sha256:ts-builder-placeholder');
  });

  it('table callback can return undefined', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', () => undefined)
      .build();
    expect(contract.storage.tables.user).toBeDefined();
  });

  it('table callback can return different builder', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) => {
        const builder = t.column('id', { type: 'pg/int4@1' });
        return builder;
      })
      .build();
    expect(contract.storage.tables.user.columns.id).toBeDefined();
  });

  it('model callback can return undefined', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) => t.column('id', { type: 'pg/int4@1' }).primaryKey(['id']))
      .model('User', 'user', () => undefined)
      .build();
    expect(contract.models.User).toBeDefined();
  });

  it('model callback can return different builder', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) => t.column('id', { type: 'pg/int4@1' }).primaryKey(['id']))
      .model('User', 'user', (m) => {
        const builder = m.field('id', 'id');
        return builder;
      })
      .build();
    expect(contract.models.User.fields.id).toBeDefined();
  });

  it('builds table without primary key', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) => t.column('id', { type: 'pg/int4@1' }))
      .build();
    expect(contract.storage.tables.user.columns.id).toBeDefined();
    expect(contract.storage.tables.user.primaryKey).toBeUndefined();
  });

  it('builds model with relations', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) => t.column('id', { type: 'pg/int4@1' }).primaryKey(['id']))
      .table('post', (t) =>
        t
          .column('id', { type: 'pg/int4@1' })
          .column('userId', { type: 'pg/int4@1' })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) => m.field('id', 'id'))
      .model('Post', 'post', (m) =>
        m
          .field('id', 'id')
          .field('userId', 'userId')
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
      .build();
    expect(contract.models.Post.relations).toBeDefined();
    expect(contract.relations.post).toBeDefined();
    expect(contract.relations.post?.user).toBeDefined();
  });

  it('builds contract with multiple tables and models', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) => t.column('id', { type: 'pg/int4@1' }).primaryKey(['id']))
      .table('post', (t) =>
        t
          .column('id', { type: 'pg/int4@1' })
          .column('userId', { type: 'pg/int4@1' })
          .primaryKey(['id']),
      )
      .table('comment', (t) =>
        t
          .column('id', { type: 'pg/int4@1' })
          .column('postId', { type: 'pg/int4@1' })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) => m.field('id', 'id'))
      .model('Post', 'post', (m) => m.field('id', 'id').field('userId', 'userId'))
      .model('Comment', 'comment', (m) => m.field('id', 'id').field('postId', 'postId'))
      .build();
    expect(contract.storage.tables.user).toBeDefined();
    expect(contract.storage.tables.post).toBeDefined();
    expect(contract.storage.tables.comment).toBeDefined();
    expect(contract.models.User).toBeDefined();
    expect(contract.models.Post).toBeDefined();
    expect(contract.models.Comment).toBeDefined();
  });

  it('handles empty table state gracefully', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', () => undefined)
      .build();
    expect(contract.storage.tables).toBeDefined();
  });

  it('handles empty model state gracefully', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) => t.column('id', { type: 'pg/int4@1' }).primaryKey(['id']))
      .model('User', 'user', () => undefined)
      .build();
    expect(contract.models).toBeDefined();
  });

  it('builds contract with all optional fields', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .coreHash('sha256:custom')
      .extensions({ pack: { config: true } })
      .capabilities({ feature: { enabled: true } })
      .table('user', (t) => t.column('id', { type: 'pg/int4@1' }).primaryKey(['id']))
      .model('User', 'user', (m) => m.field('id', 'id'))
      .build();
    expect(contract.coreHash).toBe('sha256:custom');
    expect(contract.extensions).toEqual({ pack: { config: true } });
    expect(contract.capabilities).toEqual({ feature: { enabled: true } });
  });
});
