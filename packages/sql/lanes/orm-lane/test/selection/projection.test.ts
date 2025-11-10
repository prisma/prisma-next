import type { AnyColumnBuilder, NestedProjection } from '@prisma-next/sql-relational-core/types';
import type { TableRef } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import {
  AliasTracker,
  buildProjectionState,
  flattenProjection,
  type ProjectionInput,
} from '../../src/selection/projection';

describe('projection', () => {
  describe('AliasTracker', () => {
    it('registers alias for path', () => {
      const tracker = new AliasTracker();
      const alias = tracker.register(['user', 'id']);
      expect(alias).toBe('user_id');
      expect(tracker.has('user_id')).toBe(true);
      expect(tracker.getPath('user_id')).toEqual(['user', 'id']);
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
      expect(tracker.getPath('nonexistent')).toBeUndefined();
      expect(tracker.has('nonexistent')).toBe(false);
    });

    it('handles multiple aliases', () => {
      const tracker = new AliasTracker();
      const alias1 = tracker.register(['user', 'id']);
      const alias2 = tracker.register(['user', 'email']);
      expect(alias1).toBe('user_id');
      expect(alias2).toBe('user_email');
      expect(tracker.has('user_id')).toBe(true);
      expect(tracker.has('user_email')).toBe(true);
    });
  });

  describe('flattenProjection', () => {
    it('flattens simple projection with column builder', () => {
      const tracker = new AliasTracker();
      const colBuilder: AnyColumnBuilder = {
        kind: 'column',
        table: 'user',
        column: 'id',
        columnMeta: { type: 'pg/int4@1', nullable: false },
      };
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
        columnMeta: { type: 'pg/int4@1', nullable: false },
      };
      const col2: AnyColumnBuilder = {
        kind: 'column',
        table: 'user',
        column: 'email',
        columnMeta: { type: 'pg/text@1', nullable: true },
      };
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
        columnMeta: { type: 'pg/int4@1', nullable: false },
      };
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
        columnMeta: { type: 'pg/int4@1', nullable: false },
      };
      const projection: NestedProjection = {
        id: col,
      };

      const result = flattenProjection(projection, tracker, ['base']);

      expect(result.aliases).toEqual(['base_id']);
      expect(result.columns).toEqual([col]);
    });
  });

  describe('buildProjectionState', () => {
    const table: TableRef = { name: 'user', alias: 'u' };

    it('builds projection state with column builder', () => {
      const col: AnyColumnBuilder = {
        kind: 'column',
        table: 'user',
        column: 'id',
        columnMeta: { type: 'pg/int4@1', nullable: false },
      };
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
          table: { name: 'post', alias: 'p' },
          on: {
            parentCols: ['id'],
            childCols: ['userId'],
          },
          childProjection: {
            aliases: ['id'],
            columns: [
              {
                kind: 'column',
                table: 'post',
                column: 'id',
                columnMeta: { type: 'pg/int4@1', nullable: false },
              } as AnyColumnBuilder,
            ],
          },
        },
      ];

      const result = buildProjectionState(table, projection, includes);

      expect(result.aliases).toEqual(['posts']);
      expect(result.columns).toHaveLength(1);
      expect(result.columns[0]?.kind).toBe('column');
      expect(result.columns[0]?.table).toBe('post');
      expect(result.columns[0]?.columnMeta?.type).toBe('core/json@1');
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
        columnMeta: { type: 'pg/int4@1', nullable: false },
      };
      const col2: AnyColumnBuilder = {
        kind: 'column',
        table: 'user',
        column: 'email',
        columnMeta: { type: 'pg/text@1', nullable: true },
      };
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
        columnMeta: { type: 'pg/int4@1', nullable: false },
      };
      const projection: ProjectionInput = {
        id: col,
        posts: true,
      };
      const includes = [
        {
          alias: 'posts',
          table: { name: 'post', alias: 'p' },
          on: {
            parentCols: ['id'],
            childCols: ['userId'],
          },
          childProjection: {
            aliases: ['id'],
            columns: [
              {
                kind: 'column',
                table: 'post',
                column: 'id',
                columnMeta: { type: 'pg/int4@1', nullable: false },
              } as AnyColumnBuilder,
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
        columnMeta: { type: 'pg/int4@1', nullable: false },
      };
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
