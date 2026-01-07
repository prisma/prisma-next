import type { StorageColumn } from '@prisma-next/sql-contract/types';
import type { TableRef } from '@prisma-next/sql-relational-core/ast';
import type { AnyColumnBuilder, NestedProjection } from '@prisma-next/sql-relational-core/types';
import { describe, expect, it } from 'vitest';
import {
  AliasTracker,
  buildProjectionState,
  flattenProjection,
  type ProjectionInput,
} from '../../src/selection/projection.ts';

function createMockColumnBuilder(
  table: string,
  column: string,
  columnMeta: { codecId: string; nativeType: string; nullable: boolean },
): AnyColumnBuilder {
  const normalizedMeta = convertColumnMeta(columnMeta);
  return {
    kind: 'column',
    table,
    column,
    columnMeta: normalizedMeta,
    eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
    asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
    desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
    __jsType: undefined,
  } as unknown as AnyColumnBuilder;
}

function convertColumnMeta(meta: {
  codecId: string;
  nativeType: string;
  nullable: boolean;
}): StorageColumn {
  return {
    nativeType: meta.nativeType,
    codecId: meta.codecId,
    nullable: meta.nullable,
  };
}

describe('projection', () => {
  describe('AliasTracker', () => {
    it('registers alias for path', () => {
      const tracker = new AliasTracker();
      const alias = tracker.register(['user', 'id']);
      expect({
        alias,
        has: tracker.has('user_id'),
        path: tracker.getPath('user_id'),
      }).toMatchObject({
        alias: 'user_id',
        has: true,
        path: ['user', 'id'],
      });
    });

    it('throws error on alias collision', () => {
      const tracker = new AliasTracker();
      tracker.register(['user', 'id']);
      expect(() => tracker.register(['user', 'id'])).toThrow('Alias collision');
    });

    it('throws error on empty path', () => {
      const tracker = new AliasTracker();
      expect(() => tracker.register([])).toThrow('Alias path cannot be empty');
    });

    it('returns undefined for non-existent alias', () => {
      const tracker = new AliasTracker();
      expect({
        path: tracker.getPath('nonexistent'),
        has: tracker.has('nonexistent'),
      }).toMatchObject({
        path: undefined,
        has: false,
      });
    });

    it('handles multiple aliases', () => {
      const tracker = new AliasTracker();
      const alias1 = tracker.register(['user', 'id']);
      const alias2 = tracker.register(['user', 'email']);
      expect({
        alias1,
        alias2,
        has1: tracker.has('user_id'),
        has2: tracker.has('user_email'),
      }).toMatchObject({
        alias1: 'user_id',
        alias2: 'user_email',
        has1: true,
        has2: true,
      });
    });
  });

  describe('flattenProjection', () => {
    it('flattens simple projection with column builder', () => {
      const tracker = new AliasTracker();
      const colBuilder: AnyColumnBuilder = {
        kind: 'column',
        table: 'user',
        column: 'id',
        columnMeta: convertColumnMeta({
          codecId: 'pg/int4@1',
          nativeType: 'int4',
          nullable: false,
        }),
        eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
        asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
        desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
        __jsType: undefined,
      } as unknown as AnyColumnBuilder;
      const projection: NestedProjection = {
        id: colBuilder,
      };

      const result = flattenProjection(projection, tracker);

      expect(result.aliases).toEqual(['id']);
      expect(result.columns).toEqual([colBuilder]);
    });

    it('flattens nested projection', () => {
      const tracker = new AliasTracker();
      const col1: AnyColumnBuilder = {
        kind: 'column',
        table: 'user',
        column: 'id',
        columnMeta: convertColumnMeta({
          codecId: 'pg/int4@1',
          nativeType: 'int4',
          nullable: false,
        }),
        eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
        asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
        desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
        __jsType: undefined,
      } as unknown as AnyColumnBuilder;
      const col2: AnyColumnBuilder = {
        kind: 'column',
        table: 'user',
        column: 'email',
        columnMeta: convertColumnMeta({ codecId: 'pg/text@1', nativeType: 'text', nullable: true }),
        eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
        asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
        desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
        __jsType: undefined,
      } as unknown as AnyColumnBuilder;
      const projection: NestedProjection = {
        user: {
          id: col1,
          email: col2,
        },
      };

      const result = flattenProjection(projection, tracker);

      expect(result.aliases).toEqual(['user_id', 'user_email']);
      expect(result.columns).toEqual([col1, col2]);
    });

    it('flattens deeply nested projection', () => {
      const tracker = new AliasTracker();
      const col: AnyColumnBuilder = {
        kind: 'column',
        table: 'user',
        column: 'id',
        columnMeta: convertColumnMeta({
          codecId: 'pg/int4@1',
          nativeType: 'int4',
          nullable: false,
        }),
        eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
        asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
        desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
        __jsType: undefined,
      } as unknown as AnyColumnBuilder;
      const projection: NestedProjection = {
        user: {
          profile: {
            id: col,
          },
        },
      };

      const result = flattenProjection(projection, tracker);

      expect(result.aliases).toEqual(['user_profile_id']);
      expect(result.columns).toEqual([col]);
    });

    it('throws error on invalid projection value', () => {
      const tracker = new AliasTracker();
      const projection = {
        id: 'invalid' as unknown as AnyColumnBuilder,
      };

      expect(() => flattenProjection(projection, tracker)).toThrow('Invalid projection value');
    });

    it('flattens projection with currentPath', () => {
      const tracker = new AliasTracker();
      const col: AnyColumnBuilder = {
        kind: 'column',
        table: 'user',
        column: 'id',
        columnMeta: convertColumnMeta({
          codecId: 'pg/int4@1',
          nativeType: 'int4',
          nullable: false,
        }),
        eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
        asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
        desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
        __jsType: undefined,
      } as unknown as AnyColumnBuilder;
      const projection: NestedProjection = {
        id: col,
      };

      const result = flattenProjection(projection, tracker, ['base']);

      expect(result.aliases).toEqual(['base_id']);
      expect(result.columns).toEqual([col]);
    });
  });

  describe('buildProjectionState', () => {
    const table: TableRef = { kind: 'table', name: 'user' };

    it('builds projection state with column builder', () => {
      const col: AnyColumnBuilder = {
        kind: 'column',
        table: 'user',
        column: 'id',
        columnMeta: convertColumnMeta({
          codecId: 'pg/int4@1',
          nativeType: 'int4',
          nullable: false,
        }),
        eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
        asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
        desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
        __jsType: undefined,
      } as unknown as AnyColumnBuilder;
      const projection: ProjectionInput = {
        id: col,
      };

      const result = buildProjectionState(table, projection);

      expect(result.aliases).toEqual(['id']);
      expect(result.columns).toEqual([col]);
    });

    it('builds projection state with include alias', () => {
      const projection: ProjectionInput = {
        posts: true,
      };
      const includes = [
        {
          alias: 'posts',
          table: { kind: 'table' as const, name: 'post' },
          on: {
            kind: 'join-on' as const,
            left: createMockColumnBuilder('user', 'id', {
              codecId: 'pg/int4@1',
              nativeType: 'int4',
              nullable: false,
            }),
            right: createMockColumnBuilder('post', 'userId', {
              codecId: 'pg/int4@1',
              nativeType: 'int4',
              nullable: false,
            }),
          },
          childProjection: {
            aliases: ['id'],
            columns: [
              createMockColumnBuilder('post', 'id', {
                codecId: 'pg/int4@1',
                nativeType: 'int4',
                nullable: false,
              }),
            ],
          },
        },
      ];

      const result = buildProjectionState(table, projection, includes);

      expect({
        aliases: result.aliases,
        columnCount: result.columns.length,
        firstColumn: result.columns[0],
      }).toMatchObject({
        aliases: ['posts'],
        columnCount: 1,
        firstColumn: {
          kind: 'column',
          table: 'post',
          columnMeta: convertColumnMeta({
            codecId: 'core/json@1',
            nativeType: 'jsonb',
            nullable: true,
          }),
        },
      });
    });

    it('throws error when include alias not found', () => {
      const projection: ProjectionInput = {
        posts: true,
      };

      expect(() => buildProjectionState(table, projection)).toThrow(
        'Include alias "posts" not found',
      );
    });

    it('builds projection state with nested projection', () => {
      const col1: AnyColumnBuilder = {
        kind: 'column',
        table: 'user',
        column: 'id',
        columnMeta: convertColumnMeta({
          codecId: 'pg/int4@1',
          nativeType: 'int4',
          nullable: false,
        }),
        eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
        asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
        desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
        __jsType: undefined,
      } as unknown as AnyColumnBuilder;
      const col2: AnyColumnBuilder = {
        kind: 'column',
        table: 'user',
        column: 'email',
        columnMeta: convertColumnMeta({ codecId: 'pg/text@1', nativeType: 'text', nullable: true }),
        eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
        asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
        desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
        __jsType: undefined,
      } as unknown as AnyColumnBuilder;
      const projection: ProjectionInput = {
        user: {
          id: col1,
          email: col2,
        },
      };

      const result = buildProjectionState(table, projection);

      expect(result.aliases).toEqual(['user_id', 'user_email']);
      expect(result.columns).toEqual([col1, col2]);
    });

    it('throws error on empty projection', () => {
      const projection: ProjectionInput = {};

      expect(() => buildProjectionState(table, projection)).toThrow(
        'select() requires at least one column or include',
      );
    });

    it('throws error on invalid projection key', () => {
      const projection = {
        id: null as unknown as AnyColumnBuilder,
      };

      expect(() => buildProjectionState(table, projection)).toThrow(
        'Invalid projection value at key "id"',
      );
    });

    it('builds projection state with mixed column and include', () => {
      const col: AnyColumnBuilder = {
        kind: 'column',
        table: 'user',
        column: 'id',
        columnMeta: convertColumnMeta({
          codecId: 'pg/int4@1',
          nativeType: 'int4',
          nullable: false,
        }),
        eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
        asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
        desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
        __jsType: undefined,
      } as unknown as AnyColumnBuilder;
      const projection: ProjectionInput = {
        id: col,
        posts: true,
      };
      const includes = [
        {
          alias: 'posts',
          table: { kind: 'table' as const, name: 'post' },
          on: {
            kind: 'join-on' as const,
            left: createMockColumnBuilder('user', 'id', {
              codecId: 'pg/int4@1',
              nativeType: 'int4',
              nullable: false,
            }),
            right: createMockColumnBuilder('post', 'userId', {
              codecId: 'pg/int4@1',
              nativeType: 'int4',
              nullable: false,
            }),
          },
          childProjection: {
            aliases: ['id'],
            columns: [
              createMockColumnBuilder('post', 'id', {
                codecId: 'pg/int4@1',
                nativeType: 'int4',
                nullable: false,
              }),
            ],
          },
        },
      ];

      const result = buildProjectionState(table, projection, includes);

      expect(result.aliases).toHaveLength(2);
      expect(result.aliases).toContain('id');
      expect(result.aliases).toContain('posts');
      expect(result.columns).toHaveLength(2);
    });

    it('handles alias collision in nested projection', () => {
      const col: AnyColumnBuilder = {
        kind: 'column',
        table: 'user',
        column: 'id',
        columnMeta: convertColumnMeta({
          codecId: 'pg/int4@1',
          nativeType: 'int4',
          nullable: false,
        }),
        eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
        asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
        desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
        __jsType: undefined,
      } as unknown as AnyColumnBuilder;
      const projection: ProjectionInput = {
        user_id: col,
        user: {
          id: col,
        },
      };

      expect(() => buildProjectionState(table, projection)).toThrow('Alias collision');
    });
  });
});
