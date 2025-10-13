import { describe, it, expect } from 'vitest';
import { buildRelationGraph, resolveUnique, hasIndexForEquality } from '../src/relations-graph';
import { validateContract } from '../src/schema';

describe('buildRelationGraph', () => {
  const testSchema = validateContract({
    target: 'postgres',
    tables: {
      user: {
        columns: {
          id: { type: 'int4', nullable: false },
          email: { type: 'text', nullable: false },
        },
        primaryKey: { kind: 'primaryKey', columns: ['id'] },
        uniques: [{ kind: 'unique', columns: ['email'] }],
        foreignKeys: [],
        indexes: [],
      },
      post: {
        columns: {
          id: { type: 'int4', nullable: false },
          user_id: { type: 'int4', nullable: false },
          title: { type: 'text', nullable: false },
        },
        primaryKey: { kind: 'primaryKey', columns: ['id'] },
        uniques: [],
        foreignKeys: [
          {
            kind: 'foreignKey',
            columns: ['user_id'],
            references: { table: 'user', columns: ['id'] },
            name: 'post_user_id_fkey',
          },
        ],
        indexes: [],
      },
    },
  });

  it('detects 1:N relation from user to posts', () => {
    const graph = buildRelationGraph(testSchema);
    const userEdges = graph.reverseEdges.get('user');

    expect(userEdges).toHaveLength(1);
    expect(userEdges![0]).toEqual({
      from: { table: 'post', columns: ['user_id'] },
      to: { table: 'user', columns: ['id'] },
      cardinality: '1:N',
      name: 'post', // source table name
    });
  });

  it('detects N:1 relation from post to user', () => {
    const graph = buildRelationGraph(testSchema);
    const postEdges = graph.edges.get('post');

    expect(postEdges).toHaveLength(1);
    expect(postEdges![0]).toEqual({
      from: { table: 'post', columns: ['user_id'] },
      to: { table: 'user', columns: ['id'] },
      cardinality: 'N:1',
      name: 'user', // inferred from 'user_id' → 'user'
    });
  });

  it('infers relation name from FK column name', () => {
    const graph = buildRelationGraph(testSchema);

    // Check that 'user_id' becomes 'user'
    const postEdges = graph.edges.get('post');
    expect(postEdges![0].name).toBe('user');

    const userEdges = graph.reverseEdges.get('user');
    expect(userEdges![0].name).toBe('post');
  });

  it('handles missing FK gracefully', () => {
    const schemaWithNoFks = validateContract({
      target: 'postgres',
      tables: {
        user: {
          columns: { id: { type: 'int4', nullable: false } },
          primaryKey: { kind: 'primaryKey', columns: ['id'] },
          uniques: [],
          foreignKeys: [],
          indexes: [],
        },
      },
    });

    const graph = buildRelationGraph(schemaWithNoFks);
    expect(graph.edges.size).toBe(0);
    expect(graph.reverseEdges.size).toBe(0);
  });

  it('validates FK references point to existing table', () => {
    const invalidSchema = {
      target: 'postgres' as const,
      tables: {
        post: {
          columns: { id: { type: 'int4' as const, nullable: false } },
          primaryKey: { kind: 'primaryKey' as const, columns: ['id'] },
          uniques: [],
          foreignKeys: [
            {
              kind: 'foreignKey' as const,
              columns: ['user_id'],
              references: { table: 'nonexistent', columns: ['id'] },
            },
          ],
          indexes: [],
        },
      },
    };

    expect(() => buildRelationGraph(invalidSchema as any)).toThrow(
      'Foreign key references non-existent table: nonexistent',
    );
  });
});

describe('resolveUnique', () => {
  const testSchema = validateContract({
    target: 'postgres',
    tables: {
      user: {
        columns: {
          id: { type: 'int4', nullable: false },
          email: { type: 'text', nullable: false },
        },
        primaryKey: { kind: 'primaryKey', columns: ['id'] },
        uniques: [{ kind: 'unique', columns: ['email'] }],
        foreignKeys: [],
        indexes: [],
      },
    },
  });

  it('resolves primary key', () => {
    const result = resolveUnique(testSchema, 'user', ['id']);
    expect(result).toEqual({ kind: 'pk', columns: ['id'] });
  });

  it('resolves unique constraint', () => {
    const result = resolveUnique(testSchema, 'user', ['email']);
    expect(result).toEqual({ kind: 'unique', columns: ['email'] });
  });

  it('returns null for non-unique columns', () => {
    const result = resolveUnique(testSchema, 'user', ['id', 'email']);
    expect(result).toBeNull();
  });

  it('returns null for non-existent table', () => {
    const result = resolveUnique(testSchema, 'nonexistent', ['id']);
    expect(result).toBeNull();
  });
});

describe('hasIndexForEquality', () => {
  const testSchema = validateContract({
    target: 'postgres',
    tables: {
      user: {
        columns: {
          id: { type: 'int4', nullable: false },
          email: { type: 'text', nullable: false },
          name: { type: 'text', nullable: false },
        },
        primaryKey: { kind: 'primaryKey', columns: ['id'] },
        uniques: [{ kind: 'unique', columns: ['email'] }],
        foreignKeys: [],
        indexes: [{ columns: ['name'], unique: false }],
      },
    },
  });

  it('returns true for primary key column', () => {
    expect(hasIndexForEquality(testSchema, 'user', 'id')).toBe(true);
  });

  it('returns true for unique constraint column', () => {
    expect(hasIndexForEquality(testSchema, 'user', 'email')).toBe(true);
  });

  it('returns true for indexed column', () => {
    expect(hasIndexForEquality(testSchema, 'user', 'name')).toBe(true);
  });

  it('returns false for non-indexed column', () => {
    const schemaWithoutIndex = validateContract({
      target: 'postgres',
      tables: {
        user: {
          columns: { id: { type: 'int4', nullable: false } },
          primaryKey: { kind: 'primaryKey', columns: ['id'] },
          uniques: [],
          foreignKeys: [],
          indexes: [],
        },
      },
    });

    expect(hasIndexForEquality(schemaWithoutIndex, 'user', 'email')).toBe(false);
  });

  it('returns false for non-existent table', () => {
    expect(hasIndexForEquality(testSchema, 'nonexistent', 'id')).toBe(false);
  });
});
