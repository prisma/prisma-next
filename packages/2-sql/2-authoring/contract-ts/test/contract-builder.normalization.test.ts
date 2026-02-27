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

describe('contract builder normalization', () => {
  it('normalizes nullable to false when not provided', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) => t.column('id', { type: int4Column }).primaryKey(['id']))
      .model('User', 'user', (m) => m.field('id', 'id'))
      .build();

    expect(contract.storage.tables.user.columns.id.nullable).toBe(false);
  });

  it('normalizes nullable to provided value', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) =>
        t
          .column('id', { type: int4Column, nullable: false })
          .column('email', { type: textColumn, nullable: true }),
      )
      .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
      .build();

    expect(contract.storage.tables.user.columns.id.nullable).toBe(false);
    expect(contract.storage.tables.user.columns.email.nullable).toBe(true);
  });

  it('normalizes uniques to empty array when not provided', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) => t.column('id', { type: int4Column }).primaryKey(['id']))
      .model('User', 'user', (m) => m.field('id', 'id'))
      .build();

    expect(contract.storage.tables.user.uniques).toEqual([]);
    expect(Array.isArray(contract.storage.tables.user.uniques)).toBe(true);
  });

  it('normalizes indexes to empty array when not provided', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) => t.column('id', { type: int4Column }).primaryKey(['id']))
      .model('User', 'user', (m) => m.field('id', 'id'))
      .build();

    expect(contract.storage.tables.user.indexes).toEqual([]);
    expect(Array.isArray(contract.storage.tables.user.indexes)).toBe(true);
  });

  it('normalizes foreignKeys to empty array when not provided', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) => t.column('id', { type: int4Column }).primaryKey(['id']))
      .model('User', 'user', (m) => m.field('id', 'id'))
      .build();

    expect(contract.storage.tables.user.foreignKeys).toEqual([]);
    expect(Array.isArray(contract.storage.tables.user.foreignKeys)).toBe(true);
  });

  it('normalizes relations to empty object when not provided', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) => t.column('id', { type: int4Column }).primaryKey(['id']))
      .model('User', 'user', (m) => m.field('id', 'id'))
      .build();

    expect(contract.models.User).toHaveProperty('relations');
    const userModel = contract.models.User as { relations?: Record<string, unknown> };
    expect(userModel.relations).toEqual({});
    expect(typeof userModel.relations).toBe('object');
    expect(Array.isArray(userModel.relations)).toBe(false);
  });

  it('normalizes all required fields in a complete contract', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
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
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
      .model('Post', 'post', (m) => m.field('id', 'id').field('userId', 'userId'))
      .build();

    // Verify all tables have normalized fields
    expect(contract.storage.tables.user.uniques).toEqual([]);
    expect(contract.storage.tables.user.indexes).toEqual([]);
    expect(contract.storage.tables.user.foreignKeys).toEqual([]);
    expect(contract.storage.tables.post.uniques).toEqual([]);
    expect(contract.storage.tables.post.indexes).toEqual([]);
    expect(contract.storage.tables.post.foreignKeys).toEqual([]);

    // Verify all models have normalized relations
    const userModel = contract.models.User as { relations?: Record<string, unknown> };
    const postModel = contract.models.Post as { relations?: Record<string, unknown> };
    expect(userModel.relations).toEqual({});
    expect(postModel.relations).toEqual({});

    // Verify nullable is normalized
    expect(contract.storage.tables.user.columns.id.nullable).toBe(false);
    expect(contract.storage.tables.user.columns.email.nullable).toBe(false);
  });

  it('passes through BM25 index fields (using, keyField, fieldConfigs)', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('items', (t) =>
        t
          .column('id', { type: int4Column, nullable: false })
          .column('description', { type: textColumn, nullable: false })
          .primaryKey(['id'])
          .bm25Index({
            fields: [{ column: 'description', tokenizer: 'simple' }],
            name: 'search_idx',
          }),
      )
      .build();

    const indexes = contract.storage.tables.items.indexes;
    expect(indexes).toHaveLength(1);
    expect(indexes[0]).toMatchObject({
      columns: ['description'],
      using: 'bm25',
      keyField: 'id',
      name: 'search_idx',
      fieldConfigs: [{ column: 'description', tokenizer: 'simple' }],
    });
  });

  it('passes through BM25 index with expression-based fields', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('items', (t) =>
        t
          .column('id', { type: int4Column, nullable: false })
          .column('description', { type: textColumn, nullable: false })
          .primaryKey(['id'])
          .bm25Index({
            fields: [
              { column: 'description' },
              {
                expression: "description || ' ' || category",
                alias: 'concat',
                tokenizer: 'simple',
              },
            ],
          }),
      )
      .build();

    const idx = contract.storage.tables.items.indexes[0]!;
    expect(idx.using).toBe('bm25');
    expect(idx.fieldConfigs).toHaveLength(2);
    expect(idx.fieldConfigs![1]).toMatchObject({
      expression: "description || ' ' || category",
      alias: 'concat',
    });
  });

  it('preserves plain indexes without BM25 fields', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) =>
        t
          .column('id', { type: int4Column, nullable: false })
          .column('email', { type: textColumn, nullable: false })
          .primaryKey(['id'])
          .index(['email']),
      )
      .build();

    const idx = contract.storage.tables.user.indexes[0]!;
    expect(idx.columns).toEqual(['email']);
    expect(idx).not.toHaveProperty('using');
    expect(idx).not.toHaveProperty('keyField');
    expect(idx).not.toHaveProperty('fieldConfigs');
  });

  it('normalizes contract-level relations to empty object', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) => t.column('id', { type: int4Column }).primaryKey(['id']))
      .model('User', 'user', (m) => m.field('id', 'id'))
      .build();

    expect(contract.relations).toEqual({});
    expect(typeof contract.relations).toBe('object');
  });
});
