import { describe, expect, it } from 'vitest';
import { createColumnRef, createParamRef, createTableRef } from '../../src/ast/common';
import { createBinaryExpr, createExistsExpr } from '../../src/ast/predicate';
import { createSelectAst } from '../../src/ast/select';
import type { ColumnRef, OperationExpr, SelectAst } from '../../src/ast/types';

function createTestOperationExpr(self: ColumnRef): OperationExpr {
  return {
    kind: 'operation',
    method: 'test',
    forTypeId: 'pg/text@1',
    self,
    args: [],
    returns: { kind: 'builtin', type: 'string' },
    lowering: {
      targetFamily: 'sql',
      strategy: 'function',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
      template: 'test(${self})',
    },
  };
}

function createTestSubquery(tableName: string): SelectAst {
  return createSelectAst({
    from: createTableRef(tableName),
    project: [
      {
        alias: 'id',
        expr: createColumnRef(tableName, 'id'),
      },
    ],
  });
}

describe('ast/predicate', () => {
  describe('createBinaryExpr', () => {
    it('creates binary expr with column ref and param ref', () => {
      const left = createColumnRef('user', 'id');
      const right = createParamRef(0, 'userId');
      const binaryExpr = createBinaryExpr('eq', left, right);

      expect(binaryExpr).toMatchObject({
        kind: 'bin',
        op: 'eq',
        left,
        right,
      });
    });

    it('creates binary expr with operation expr and param ref', () => {
      const left = createTestOperationExpr(createColumnRef('user', 'email'));
      const right = createParamRef(0, 'value');
      const binaryExpr = createBinaryExpr('eq', left, right);

      expect(binaryExpr.left).toBe(left);
      expect(binaryExpr.right).toBe(right);
    });

    it('creates binary expr with different param ref index', () => {
      const left = createColumnRef('user', 'email');
      const right = createParamRef(1, 'email');
      const binaryExpr = createBinaryExpr('eq', left, right);

      expect(binaryExpr.right).toMatchObject({
        kind: 'param',
        index: 1,
        name: 'email',
      });
    });

    it('creates binary expr with column ref on the right', () => {
      const left = createColumnRef('user', 'id');
      const right = createColumnRef('post', 'userId');
      const binaryExpr = createBinaryExpr('eq', left, right);

      expect(binaryExpr).toMatchObject({
        kind: 'bin',
        op: 'eq',
        left,
        right: { kind: 'col', table: 'post', column: 'userId' },
      });
    });

    it.each(['eq', 'neq', 'gt', 'lt', 'gte', 'lte'] as const)(
      'creates binary expr with %s operator',
      (op) => {
        const left = createColumnRef('user', 'id');
        const right = createColumnRef('post', 'userId');
        const binaryExpr = createBinaryExpr(op, left, right);

        expect(binaryExpr.op).toBe(op);
        expect(binaryExpr.right.kind).toBe('col');
      },
    );

    it('creates binary expr with operation expr and column ref on the right', () => {
      const left = createTestOperationExpr(createColumnRef('user', 'email'));
      const right = createColumnRef('post', 'email');
      const binaryExpr = createBinaryExpr('eq', left, right);

      expect(binaryExpr.left).toBe(left);
      expect(binaryExpr.right).toMatchObject({
        kind: 'col',
        table: 'post',
        column: 'email',
      });
    });
  });

  describe('createExistsExpr', () => {
    it('creates exists expr with subquery', () => {
      const subquery = createTestSubquery('user');
      const existsExpr = createExistsExpr(false, subquery);

      expect(existsExpr).toMatchObject({
        kind: 'exists',
        not: false,
        subquery,
      });
    });

    it('creates exists expr with not flag', () => {
      const subquery = createTestSubquery('user');
      const existsExpr = createExistsExpr(true, subquery);

      expect(existsExpr.not).toBe(true);
      expect(existsExpr.subquery).toBe(subquery);
    });

    it('creates exists expr with different table subquery', () => {
      const subquery = createTestSubquery('post');
      const existsExpr = createExistsExpr(false, subquery);

      expect(existsExpr.subquery).toBe(subquery);
      expect(existsExpr.subquery.from.name).toBe('post');
    });
  });
});
