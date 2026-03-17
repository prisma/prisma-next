import type { SqlTableIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { inferRelations } from '../src/relation-inference';

describe('inferRelations', () => {
  it('infers 1:N relation from FK', () => {
    const tables: Record<string, SqlTableIR> = {
      user: {
        name: 'user',
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
      post: {
        name: 'post',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [{ columns: ['user_id'], referencedTable: 'user', referencedColumns: ['id'] }],
        uniques: [],
        indexes: [],
      },
    };
    const modelNameMap = new Map([
      ['user', 'User'],
      ['post', 'Post'],
    ]);
    const { relationsByTable } = inferRelations(tables, modelNameMap);

    // Child table (post) should have relation field
    const postRelations = relationsByTable.get('post');
    expect(postRelations).toHaveLength(1);
    expect(postRelations![0]!.fieldName).toBe('user');
    expect(postRelations![0]!.typeName).toBe('User');
    expect(postRelations![0]!.list).toBe(false);

    // Parent table (user) should have back-relation
    const userRelations = relationsByTable.get('user');
    expect(userRelations).toHaveLength(1);
    expect(userRelations![0]!.fieldName).toBe('posts');
    expect(userRelations![0]!.typeName).toBe('Post');
    expect(userRelations![0]!.list).toBe(true);
  });

  it('detects 1:1 when FK column has unique constraint', () => {
    const tables: Record<string, SqlTableIR> = {
      user: {
        name: 'user',
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
      profile: {
        name: 'profile',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [{ columns: ['user_id'], referencedTable: 'user', referencedColumns: ['id'] }],
        uniques: [{ columns: ['user_id'] }],
        indexes: [],
      },
    };
    const modelNameMap = new Map([
      ['user', 'User'],
      ['profile', 'Profile'],
    ]);
    const { relationsByTable } = inferRelations(tables, modelNameMap);

    // Back-relation should be optional (1:1), not a list
    const userRelations = relationsByTable.get('user');
    expect(userRelations).toHaveLength(1);
    expect(userRelations![0]!.optional).toBe(true);
    expect(userRelations![0]!.list).toBe(false);
  });

  it('detects 1:1 when FK columns match PK columns', () => {
    const tables: Record<string, SqlTableIR> = {
      user: {
        name: 'user',
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
      user_detail: {
        name: 'user_detail',
        columns: {
          user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
        },
        primaryKey: { columns: ['user_id'] },
        foreignKeys: [{ columns: ['user_id'], referencedTable: 'user', referencedColumns: ['id'] }],
        uniques: [],
        indexes: [],
      },
    };
    const modelNameMap = new Map([
      ['user', 'User'],
      ['user_detail', 'UserDetail'],
    ]);
    const { relationsByTable } = inferRelations(tables, modelNameMap);

    const userRelations = relationsByTable.get('user');
    expect(userRelations).toHaveLength(1);
    expect(userRelations![0]!.optional).toBe(true);
    expect(userRelations![0]!.list).toBe(false);
  });

  it('produces named relations for multiple FKs to same parent', () => {
    const tables: Record<string, SqlTableIR> = {
      user: {
        name: 'user',
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
      message: {
        name: 'message',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          sender_id: { name: 'sender_id', nativeType: 'int4', nullable: false },
          receiver_id: { name: 'receiver_id', nativeType: 'int4', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [
          {
            name: 'fk_sender',
            columns: ['sender_id'],
            referencedTable: 'user',
            referencedColumns: ['id'],
          },
          {
            name: 'fk_receiver',
            columns: ['receiver_id'],
            referencedTable: 'user',
            referencedColumns: ['id'],
          },
        ],
        uniques: [],
        indexes: [],
      },
    };
    const modelNameMap = new Map([
      ['user', 'User'],
      ['message', 'Message'],
    ]);
    const { relationsByTable } = inferRelations(tables, modelNameMap);

    const messageRelations = relationsByTable.get('message');
    expect(messageRelations).toHaveLength(2);
    expect(messageRelations![0]!.relationName).toBe('fk_sender');
    expect(messageRelations![1]!.relationName).toBe('fk_receiver');
  });

  it('handles self-referencing FKs', () => {
    const tables: Record<string, SqlTableIR> = {
      category: {
        name: 'category',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          parent_id: { name: 'parent_id', nativeType: 'int4', nullable: true },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [
          { columns: ['parent_id'], referencedTable: 'category', referencedColumns: ['id'] },
        ],
        uniques: [],
        indexes: [],
      },
    };
    const modelNameMap = new Map([['category', 'Category']]);
    const { relationsByTable } = inferRelations(tables, modelNameMap);

    const relations = relationsByTable.get('category');
    expect(relations).toHaveLength(2); // child + back-relation
    // Child relation field
    const childRel = relations!.find((r) => r.fields);
    expect(childRel?.fieldName).toBe('parent');
    expect(childRel?.typeName).toBe('Category');
    // Back-relation field
    const backRel = relations!.find((r) => !r.fields);
    expect(backRel?.typeName).toBe('Category');
    expect(backRel?.list).toBe(true);
  });

  it('includes onDelete/onUpdate when non-default', () => {
    const tables: Record<string, SqlTableIR> = {
      parent: {
        name: 'parent',
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
      child: {
        name: 'child',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          parent_id: { name: 'parent_id', nativeType: 'int4', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [
          {
            columns: ['parent_id'],
            referencedTable: 'parent',
            referencedColumns: ['id'],
            onDelete: 'cascade',
            onUpdate: 'setNull',
          },
        ],
        uniques: [],
        indexes: [],
      },
    };
    const modelNameMap = new Map([
      ['parent', 'Parent'],
      ['child', 'Child'],
    ]);
    const { relationsByTable } = inferRelations(tables, modelNameMap);

    const childRelations = relationsByTable.get('child');
    expect(childRelations![0]!.onDelete).toBe('Cascade');
    expect(childRelations![0]!.onUpdate).toBe('SetNull');
  });
});
