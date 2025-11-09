import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import { describe, expect, it } from 'vitest';
import type { CodecTypes } from './fixtures/contract.d';

describe('contract builder normalization', () => {
  it('normalizes nullable to false when not provided', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) => t.column('id', { type: 'pg/int4@1' }).primaryKey(['id']))
      .model('User', 'user', (m) => m.field('id', 'id'))
      .build();

    expect(contract.storage.tables.user.columns.id.nullable).toBe(false);
  });

  it('normalizes nullable to provided value', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) =>
        t
          .column('id', { type: 'pg/int4@1', nullable: false })
          .column('email', { type: 'pg/text@1', nullable: true }),
      )
      .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
      .build();

    expect(contract.storage.tables.user.columns.id.nullable).toBe(false);
    expect(contract.storage.tables.user.columns.email.nullable).toBe(true);
  });

  it('normalizes uniques to empty array when not provided', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) => t.column('id', { type: 'pg/int4@1' }).primaryKey(['id']))
      .model('User', 'user', (m) => m.field('id', 'id'))
      .build();

    expect(contract.storage.tables.user.uniques).toEqual([]);
    expect(Array.isArray(contract.storage.tables.user.uniques)).toBe(true);
  });

  it('normalizes indexes to empty array when not provided', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) => t.column('id', { type: 'pg/int4@1' }).primaryKey(['id']))
      .model('User', 'user', (m) => m.field('id', 'id'))
      .build();

    expect(contract.storage.tables.user.indexes).toEqual([]);
    expect(Array.isArray(contract.storage.tables.user.indexes)).toBe(true);
  });

  it('normalizes foreignKeys to empty array when not provided', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) => t.column('id', { type: 'pg/int4@1' }).primaryKey(['id']))
      .model('User', 'user', (m) => m.field('id', 'id'))
      .build();

    expect(contract.storage.tables.user.foreignKeys).toEqual([]);
    expect(Array.isArray(contract.storage.tables.user.foreignKeys)).toBe(true);
  });

  it('normalizes relations to empty object when not provided', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) => t.column('id', { type: 'pg/int4@1' }).primaryKey(['id']))
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

  it('normalizes contract-level relations to empty object', () => {
    const contract = defineContract<CodecTypes>()
      .target('postgres')
      .table('user', (t) => t.column('id', { type: 'pg/int4@1' }).primaryKey(['id']))
      .model('User', 'user', (m) => m.field('id', 'id'))
      .build();

    expect(contract.relations).toEqual({});
    expect(typeof contract.relations).toBe('object');
  });
});
