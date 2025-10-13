import { describe, it, expect } from 'vitest';
import { postgresLowerer } from '../src/lowering/postgres';
import type { QueryAST, IncludeNode } from '../src/ast/types';

describe('PostgreSQL Lowerer', () => {
  describe('1:N Nested Includes', () => {
    it('generates correct FK condition for single column foreign key', () => {
      const parentAst: QueryAST = {
        type: 'select',
        from: 'user',
        select: [
          { alias: 'id', expr: { kind: 'column', name: 'id' } },
          { alias: 'email', expr: { kind: 'column', name: 'email' } },
        ],
      };

      const include: IncludeNode = {
        kind: 'Include',
        relation: {
          parent: 'user',
          child: 'post',
          cardinality: '1:N',
          on: {
            parentCols: ['id'],
            childCols: ['user_id'],
          },
          name: 'posts',
        },
        alias: 'posts',
        child: {
          type: 'select',
          from: 'post',
          select: [
            { alias: 'id', expr: { kind: 'column', name: 'id' } },
            { alias: 'title', expr: { kind: 'column', name: 'title' } },
          ],
        },
        mode: 'nested',
      };

      const result = postgresLowerer.lowerInclude(parentAst, include, {} as any);

      expect(result.type).toBe('select');
      expect(result.from).toBe('user');
      expect(result.select).toHaveLength(3); // id, email, posts

      // Check that the posts field is a COALESCE subquery
      const postsField = result.select?.find((item) => item.alias === 'posts');
      expect(postsField).toBeDefined();
      expect(postsField?.expr.kind).toBe('call');
      expect(postsField?.expr.fn).toBe('COALESCE');

      // The subquery should have a WHERE clause with the FK condition
      const subquery = postsField?.expr.args[0];
      expect(subquery?.kind).toBe('subquery');
      expect(subquery?.query.where).toBeDefined();
      expect(subquery?.query.where?.condition.kind).toBe('eq');
      expect(subquery?.query.where?.condition.left.kind).toBe('column');
      expect(subquery?.query.where?.condition.left.table).toBe('post');
      expect(subquery?.query.where?.condition.left.name).toBe('user_id');
      expect(subquery?.query.where?.condition.right.kind).toBe('column');
      expect(subquery?.query.where?.condition.right.table).toBe('user');
      expect(subquery?.query.where?.condition.right.name).toBe('id');
    });

    it('generates correct FK condition for composite foreign key', () => {
      const parentAst: QueryAST = {
        type: 'select',
        from: 'order',
        select: [
          { alias: 'id', expr: { kind: 'column', name: 'id' } },
          { alias: 'customer_id', expr: { kind: 'column', name: 'customer_id' } },
        ],
      };

      const include: IncludeNode = {
        kind: 'Include',
        relation: {
          parent: 'order',
          child: 'order_item',
          cardinality: '1:N',
          on: {
            parentCols: ['id', 'customer_id'],
            childCols: ['order_id', 'customer_id'],
          },
          name: 'items',
        },
        alias: 'items',
        child: {
          type: 'select',
          from: 'order_item',
          select: [
            { alias: 'id', expr: { kind: 'column', name: 'id' } },
            { alias: 'quantity', expr: { kind: 'column', name: 'quantity' } },
          ],
        },
        mode: 'nested',
      };

      const result = postgresLowerer.lowerInclude(parentAst, include, {} as any);

      expect(result.type).toBe('select');
      expect(result.from).toBe('order');

      // Check that the items field is a COALESCE subquery
      const itemsField = result.select?.find((item) => item.alias === 'items');
      expect(itemsField).toBeDefined();
      expect(itemsField?.expr.kind).toBe('call');
      expect(itemsField?.expr.fn).toBe('COALESCE');

      // The subquery should have a WHERE clause with AND condition for composite FK
      const subquery = itemsField?.expr.args[0];
      expect(subquery?.kind).toBe('subquery');
      expect(subquery?.query.where).toBeDefined();

      // For composite keys, the condition should be an AND of multiple EQ conditions
      const condition = subquery?.query.where?.condition;
      expect(condition?.kind).toBe('and');
      expect(condition?.left.kind).toBe('eq');
      expect(condition?.right.kind).toBe('eq');
    });

    it('handles child query with WHERE clause', () => {
      const parentAst: QueryAST = {
        type: 'select',
        from: 'user',
        select: [{ alias: 'id', expr: { kind: 'column', name: 'id' } }],
      };

      const include: IncludeNode = {
        kind: 'Include',
        relation: {
          parent: 'user',
          child: 'post',
          cardinality: '1:N',
          on: {
            parentCols: ['id'],
            childCols: ['user_id'],
          },
          name: 'posts',
        },
        alias: 'posts',
        child: {
          type: 'select',
          from: 'post',
          select: [
            { alias: 'id', expr: { kind: 'column', name: 'id' } },
            { alias: 'title', expr: { kind: 'column', name: 'title' } },
          ],
          where: {
            type: 'where',
            condition: {
              kind: 'eq',
              left: { kind: 'column', name: 'published' },
              right: { kind: 'literal', value: true },
            },
          },
        },
        mode: 'nested',
      };

      const result = postgresLowerer.lowerInclude(parentAst, include, {} as any);

      // The subquery should have both the FK condition AND the child WHERE condition
      const postsField = result.select?.find((item) => item.alias === 'posts');
      const subquery = postsField?.expr.args[0];
      expect(subquery?.query.where).toBeDefined();

      // The WHERE condition should be an AND of FK condition and child WHERE condition
      const condition = subquery?.query.where?.condition;
      expect(condition?.kind).toBe('and');
    });

    it('handles child query with LIMIT', () => {
      const parentAst: QueryAST = {
        type: 'select',
        from: 'user',
        select: [{ alias: 'id', expr: { kind: 'column', name: 'id' } }],
      };

      const include: IncludeNode = {
        kind: 'Include',
        relation: {
          parent: 'user',
          child: 'post',
          cardinality: '1:N',
          on: {
            parentCols: ['id'],
            childCols: ['user_id'],
          },
          name: 'posts',
        },
        alias: 'posts',
        child: {
          type: 'select',
          from: 'post',
          select: [
            { alias: 'id', expr: { kind: 'column', name: 'id' } },
            { alias: 'title', expr: { kind: 'column', name: 'title' } },
          ],
          limit: { type: 'limit', count: 5 },
        },
        mode: 'nested',
      };

      const result = postgresLowerer.lowerInclude(parentAst, include, {} as any);

      // The subquery should have the LIMIT clause
      const postsField = result.select?.find((item) => item.alias === 'posts');
      const subquery = postsField?.expr.args[0];
      expect(subquery?.query.limit).toBeDefined();
      expect(subquery?.query.limit?.count).toBe(5);
    });

    it('excludes ORDER BY from json_agg subqueries', () => {
      const parentAst: QueryAST = {
        type: 'select',
        from: 'user',
        select: [{ alias: 'id', expr: { kind: 'column', name: 'id' } }],
      };

      const include: IncludeNode = {
        kind: 'Include',
        relation: {
          parent: 'user',
          child: 'post',
          cardinality: '1:N',
          on: {
            parentCols: ['id'],
            childCols: ['user_id'],
          },
          name: 'posts',
        },
        alias: 'posts',
        child: {
          type: 'select',
          from: 'post',
          select: [
            { alias: 'id', expr: { kind: 'column', name: 'id' } },
            { alias: 'title', expr: { kind: 'column', name: 'title' } },
          ],
          orderBy: [{ type: 'orderBy', field: 'createdAt', direction: 'DESC' }],
        },
        mode: 'nested',
      };

      const result = postgresLowerer.lowerInclude(parentAst, include, {} as any);

      // The subquery should NOT have ORDER BY (excluded for json_agg compatibility)
      const postsField = result.select?.find((item) => item.alias === 'posts');
      const subquery = postsField?.expr.args[0];
      expect(subquery?.query.orderBy).toBeUndefined();
    });
  });

  describe('N:1 Flat Includes', () => {
    it('generates LEFT JOIN for N:1 relations', () => {
      const parentAst: QueryAST = {
        type: 'select',
        from: 'post',
        select: [
          { alias: 'id', expr: { kind: 'column', name: 'id' } },
          { alias: 'title', expr: { kind: 'column', name: 'title' } },
        ],
      };

      const include: IncludeNode = {
        kind: 'Include',
        relation: {
          parent: 'post',
          child: 'user',
          cardinality: 'N:1',
          on: {
            parentCols: ['user_id'],
            childCols: ['id'],
          },
          name: 'author',
        },
        alias: 'author',
        child: {
          type: 'select',
          from: 'user',
          select: [
            { alias: 'id', expr: { kind: 'column', name: 'id' } },
            { alias: 'email', expr: { kind: 'column', name: 'email' } },
          ],
        },
        mode: 'flat',
      };

      const result = postgresLowerer.lowerInclude(parentAst, include, {} as any);

      expect(result.type).toBe('select');
      expect(result.from).toBe('post');
      expect(result.joins).toHaveLength(1);

      const join = result.joins?.[0];
      expect(join?.type).toBe('leftJoin');
      expect(join?.table).toBe('user');
      expect(join?.alias).toBe('author');
      expect(join?.on?.kind).toBe('eq');
      expect(join?.on?.left.kind).toBe('column');
      expect(join?.on?.left.table).toBe('post');
      expect(join?.on?.left.name).toBe('user_id');
      expect(join?.on?.right.kind).toBe('column');
      expect(join?.on?.right.table).toBe('author');
      expect(join?.on?.right.name).toBe('id');
    });
  });

  describe('Error Handling', () => {
    it('throws error for unsupported include modes', () => {
      const parentAst: QueryAST = {
        type: 'select',
        from: 'user',
        select: [],
      };

      const include: IncludeNode = {
        kind: 'Include',
        relation: {
          parent: 'user',
          child: 'post',
          cardinality: '1:N',
          on: {
            parentCols: ['id'],
            childCols: ['user_id'],
          },
          name: 'posts',
        },
        alias: 'posts',
        child: {
          type: 'select',
          from: 'post',
          select: [],
        },
        mode: 'unsupported' as any,
      };

      expect(() => postgresLowerer.lowerInclude(parentAst, include, {} as any)).toThrow(
        'Unsupported include mode: unsupported for cardinality: 1:N',
      );
    });
  });
});
