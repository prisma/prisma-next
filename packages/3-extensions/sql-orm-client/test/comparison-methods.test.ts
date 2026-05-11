import {
  type AnyExpression,
  type BinaryExpr,
  ColumnRef,
  LiteralExpr,
  OperationExpr,
  ParamRef,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { COMPARISON_METHODS_META } from '../src/types';

type ScalarFactory = (
  left: AnyExpression,
  codecId: string | undefined,
) => (value: unknown) => BinaryExpr;

function eqFactory(): ScalarFactory {
  return COMPARISON_METHODS_META.eq.create as ScalarFactory;
}

function expectParamRef(value: unknown): asserts value is ParamRef {
  expect(value).toBeInstanceOf(ParamRef);
}

describe('comparison method factories', () => {
  it('creates bare params when no codec or column refs are available', () => {
    const expr = eqFactory()(LiteralExpr.of(1), undefined)('Alice');

    expectParamRef(expr.right);
    expect(expr.right.value).toBe('Alice');
    expect(expr.right.codecId).toBeUndefined();
    expect(expr.right.refs).toBeUndefined();
  });

  it('carries refs from wrapped single-column expressions without a codec id', () => {
    const wrappedColumn = new OperationExpr({
      method: 'upper',
      self: ColumnRef.of('users', 'name'),
      args: [],
      returns: { codecId: 'pg/text@1', nullable: false },
      lowering: { targetFamily: 'sql', strategy: 'function', template: 'upper({{self}})' },
    });

    const expr = eqFactory()(wrappedColumn, undefined)('Alice');

    expectParamRef(expr.right);
    expect(expr.right.value).toBe('Alice');
    expect(expr.right.codecId).toBeUndefined();
    expect(expr.right.refs).toEqual({ table: 'users', column: 'name' });
  });

  it('falls back when a wrapped expression reports an empty ref slot', () => {
    // Deliberately malformed expression: this covers the defensive branch for sparse collectColumnRefs output, which concrete AST nodes do not produce.
    const sparseRefExpression = {
      kind: 'operation',
      collectColumnRefs: () => [undefined],
    } as unknown as AnyExpression;

    const expr = eqFactory()(sparseRefExpression, undefined)('Alice');

    expectParamRef(expr.right);
    expect(expr.right.value).toBe('Alice');
    expect(expr.right.refs).toBeUndefined();
  });
});
