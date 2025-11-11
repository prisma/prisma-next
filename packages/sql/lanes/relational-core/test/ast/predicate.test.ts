import type {
  ColumnRef,
  OperationExpr,
  ParamRef,
  SelectAst,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createColumnRef, createParamRef, createTableRef } from '../../src/ast/common';
import { createBinaryExpr, createExistsExpr } from '../../src/ast/predicate';
import { createSelectAst } from '../../src/ast/select';

describe('ast/predicate', () => {
  describe('createBinaryExpr', () => {
    it('creates binary expr with column ref and param ref', () => {
      const left: ColumnRef = createColumnRef('user', 'id');
      const right: ParamRef = createParamRef(0, 'userId');

      const binaryExpr = createBinaryExpr('eq', left, right);

      expect(binaryExpr).toEqual({
        kind: 'bin',
        op: 'eq',
        left,
        right,
      });
      expect(binaryExpr.kind).toBe('bin');
      expect(binaryExpr.op).toBe('eq');
      expect(binaryExpr.left).toBe(left);
      expect(binaryExpr.right).toBe(right);
    });

    it('creates binary expr with operation expr and param ref', () => {
      const left: OperationExpr = {
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
      const right: ParamRef = createParamRef(0, 'value');

      const binaryExpr = createBinaryExpr('eq', left, right);

      expect(binaryExpr.left).toBe(left);
      expect(binaryExpr.right).toBe(right);
    });

    it('creates binary expr with different param ref', () => {
      const left: ColumnRef = createColumnRef('user', 'email');
      const right: ParamRef = createParamRef(1, 'email');

      const binaryExpr = createBinaryExpr('eq', left, right);

      expect(binaryExpr.right).toBe(right);
      expect(binaryExpr.right.index).toBe(1);
    });
  });

  describe('createExistsExpr', () => {
    it('creates exists expr with subquery', () => {
      const subquery: SelectAst = createSelectAst({
        from: createTableRef('user'),
        project: [
          {
            alias: 'id',
            expr: createColumnRef('user', 'id'),
          },
        ],
      });

      const existsExpr = createExistsExpr(false, subquery);

      expect(existsExpr).toEqual({
        kind: 'exists',
        not: false,
        subquery,
      });
      expect(existsExpr.kind).toBe('exists');
      expect(existsExpr.not).toBe(false);
      expect(existsExpr.subquery).toBe(subquery);
    });

    it('creates exists expr with not flag set to true', () => {
      const subquery: SelectAst = createSelectAst({
        from: createTableRef('user'),
        project: [
          {
            alias: 'id',
            expr: createColumnRef('user', 'id'),
          },
        ],
      });

      const existsExpr = createExistsExpr(true, subquery);

      expect(existsExpr.not).toBe(true);
      expect(existsExpr.subquery).toBe(subquery);
    });

    it('creates exists expr with different subquery', () => {
      const subquery: SelectAst = createSelectAst({
        from: createTableRef('post'),
        project: [
          {
            alias: 'id',
            expr: createColumnRef('post', 'id'),
          },
        ],
      });

      const existsExpr = createExistsExpr(false, subquery);

      expect(existsExpr.subquery).toBe(subquery);
      expect(existsExpr.subquery.from.name).toBe('post');
    });
  });
});
