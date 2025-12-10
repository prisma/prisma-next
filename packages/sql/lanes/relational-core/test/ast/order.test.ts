import { describe, expect, it } from 'vitest';
import { createColumnRef } from '../../src/ast/common';
import { createOrderByItem } from '../../src/ast/order';
import type { ColumnRef, OperationExpr } from '../../src/ast/types';

describe('ast/order', () => {
  describe('createOrderByItem', () => {
    it('creates order by item with column ref and asc direction', () => {
      const expr: ColumnRef = createColumnRef('user', 'id');
      const orderByItem = createOrderByItem(expr, 'asc');

      expect(orderByItem).toEqual({
        expr,
        dir: 'asc',
      });
      expect(orderByItem.expr).toBe(expr);
      expect(orderByItem.dir).toBe('asc');
    });

    it('creates order by item with column ref and desc direction', () => {
      const expr: ColumnRef = createColumnRef('user', 'id');
      const orderByItem = createOrderByItem(expr, 'desc');

      expect(orderByItem.dir).toBe('desc');
      expect(orderByItem.expr).toBe(expr);
    });

    it('creates order by item with operation expr and asc direction', () => {
      const expr: OperationExpr = {
        kind: 'operation',
        method: 'test',
        forTypeId: 'pg/text@1',
        self: createColumnRef('user', 'email'),
        args: [],
        returns: { kind: 'builtin', type: 'string' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: 'test(${self})',
        },
      };

      const orderByItem = createOrderByItem(expr, 'asc');

      expect(orderByItem.expr).toBe(expr);
      expect(orderByItem.dir).toBe('asc');
    });

    it('creates order by item with operation expr and desc direction', () => {
      const expr: OperationExpr = {
        kind: 'operation',
        method: 'test',
        forTypeId: 'pg/text@1',
        self: createColumnRef('user', 'email'),
        args: [],
        returns: { kind: 'builtin', type: 'string' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: 'test(${self})',
        },
      };

      const orderByItem = createOrderByItem(expr, 'desc');

      expect(orderByItem.expr).toBe(expr);
      expect(orderByItem.dir).toBe('desc');
    });

    it('creates order by item with different column', () => {
      const expr: ColumnRef = createColumnRef('post', 'title');
      const orderByItem = createOrderByItem(expr, 'asc');

      expect(orderByItem.expr).toEqual(createColumnRef('post', 'title'));
    });
  });
});
