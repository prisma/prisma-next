import type { StorageColumn } from '@prisma-next/sql-contract/types';
import { int4Column as int4ColumnType } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createColumnRef } from '../src/ast/common';
import type { ColumnRef, OperationExpr } from '../src/ast/types';
import { columnToExpression, createExpressionBuilder } from '../src/expression-builder';
import { param } from '../src/param';
import { ColumnBuilderImpl } from '../src/schema';

describe('expression-builder', () => {
  const columnMeta: StorageColumn = {
    ...int4ColumnType,
    nullable: false,
  };

  describe('createExpressionBuilder', () => {
    it('creates ExpressionBuilder from ColumnRef', () => {
      const columnRef: ColumnRef = createColumnRef('user', 'id');
      const expr = createExpressionBuilder(columnRef, columnMeta);

      expect({
        kind: expr.kind,
        exprKind: expr.expr.kind,
        exprTable: expr.expr.kind === 'col' ? expr.expr.table : undefined,
        exprColumn: expr.expr.kind === 'col' ? expr.expr.column : undefined,
        hasColumnMeta: expr.columnMeta !== undefined,
      }).toMatchObject({
        kind: 'expression',
        exprKind: 'col',
        exprTable: 'user',
        exprColumn: 'id',
        hasColumnMeta: true,
      });
    });

    it('creates ExpressionBuilder from OperationExpr', () => {
      const columnRef: ColumnRef = createColumnRef('user', 'id');
      const operationExpr: OperationExpr = {
        kind: 'operation',
        method: 'add',
        forTypeId: 'pg/int4@1',
        self: columnRef,
        args: [],
        returns: { kind: 'builtin', type: 'number' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} + ${arg0}',
        },
      };
      const expr = createExpressionBuilder(operationExpr, columnMeta);

      expect({
        kind: expr.kind,
        exprKind: expr.expr.kind,
        exprMethod: expr.expr.kind === 'operation' ? expr.expr.method : undefined,
      }).toMatchObject({
        kind: 'expression',
        exprKind: 'operation',
        exprMethod: 'add',
      });
    });
  });

  describe('comparison operators', () => {
    const operators = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte'] as const;

    it.each(operators)('%s creates binary builder with param placeholder', (op) => {
      const columnRef: ColumnRef = createColumnRef('user', 'id');
      const expr = createExpressionBuilder(columnRef, columnMeta);
      const paramPlaceholder = param('value');

      const binary = expr[op](paramPlaceholder);

      expect({
        kind: binary.kind,
        op: binary.op,
        leftKind: binary.left.kind,
        rightKind: binary.right.kind,
      }).toMatchObject({
        kind: 'binary',
        op,
        leftKind: 'expression',
        rightKind: 'param-placeholder',
      });
    });

    it.each(operators)('%s creates binary builder with column builder', (op) => {
      const columnRef: ColumnRef = createColumnRef('user', 'id');
      const expr = createExpressionBuilder(columnRef, columnMeta);
      const columnBuilder = new ColumnBuilderImpl('user', 'email', columnMeta);

      const binary = expr[op](
        columnBuilder as unknown as import('../src/types').AnyColumnBuilderBase,
      );

      expect({
        kind: binary.kind,
        op: binary.op,
        leftKind: binary.left.kind,
        rightKind: binary.right.kind,
      }).toMatchObject({
        kind: 'binary',
        op,
        leftKind: 'expression',
        rightKind: 'column',
      });
    });

    it.each(operators)('%s throws for invalid values', (op) => {
      const columnRef: ColumnRef = createColumnRef('user', 'id');
      const expr = createExpressionBuilder(columnRef, columnMeta);
      const invalidValues = [null, undefined, { kind: 'invalid' }] as unknown[];

      for (const invalidValue of invalidValues) {
        expect(() => {
          expr[op](
            invalidValue as unknown as
              | import('../src/types').ParamPlaceholder
              | import('../src/types').AnyColumnBuilderBase,
          );
        }).toThrow('Parameter placeholder or column builder required for expression comparison');
      }
    });
  });

  describe('ordering methods', () => {
    it.each(['asc', 'desc'] as const)('%s creates order builder', (method) => {
      const columnRef: ColumnRef = createColumnRef('user', 'id');
      const expr = createExpressionBuilder(columnRef, columnMeta);

      const order = expr[method]();

      expect({
        kind: order.kind,
        dir: order.dir,
        exprKind: order.expr.kind,
      }).toMatchObject({
        kind: 'order',
        dir: method,
        exprKind: 'expression',
      });
    });
  });

  describe('__jsType getter', () => {
    it('returns undefined', () => {
      const columnRef: ColumnRef = createColumnRef('user', 'id');
      const expr = createExpressionBuilder(columnRef, columnMeta);

      expect(expr.__jsType).toBeUndefined();
    });
  });

  describe('columnToExpression', () => {
    it('converts ColumnBuilder to ExpressionBuilder', () => {
      const columnBuilder = new ColumnBuilderImpl('user', 'id', columnMeta);
      const expr = columnToExpression(columnBuilder);

      expect({
        kind: expr.kind,
        exprKind: expr.expr.kind,
        exprTable: expr.expr.kind === 'col' ? expr.expr.table : undefined,
        exprColumn: expr.expr.kind === 'col' ? expr.expr.column : undefined,
        hasColumnMeta: expr.columnMeta !== undefined,
      }).toMatchObject({
        kind: 'expression',
        exprKind: 'col',
        exprTable: 'user',
        exprColumn: 'id',
        hasColumnMeta: true,
      });
    });
  });
});
