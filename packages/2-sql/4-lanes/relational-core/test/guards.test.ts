import { describe, expect, it } from 'vitest';
import { ColumnRef, OperationExpr, TableSource } from '../src/exports/ast';
import type { ExpressionBuilder, ParamPlaceholder } from '../src/types';
import {
  getColumnInfo,
  isExpressionBuilder,
  isExpressionSource,
  isParamPlaceholder,
  isValueSource,
} from '../src/utils/guards';

const placeholder: ParamPlaceholder = { kind: 'param-placeholder', name: 'id' };

function expressionBuilder(expr: OperationExpr): ExpressionBuilder {
  return {
    kind: 'expression',
    expr,
    columnMeta: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
    eq: () => {
      throw new Error('unused');
    },
    neq: () => {
      throw new Error('unused');
    },
    gt: () => {
      throw new Error('unused');
    },
    lt: () => {
      throw new Error('unused');
    },
    gte: () => {
      throw new Error('unused');
    },
    lte: () => {
      throw new Error('unused');
    },
    asc: () => {
      throw new Error('unused');
    },
    desc: () => {
      throw new Error('unused');
    },
    toExpr: () => expr,
    get __jsType() {
      return undefined;
    },
  };
}

describe('utils/guards', () => {
  it('recognizes builders, placeholders, and expression sources', () => {
    const expr = OperationExpr.function({
      method: 'lower',
      forTypeId: 'pg/text@1',
      self: ColumnRef.of('user', 'email'),
      args: [],
      returns: { kind: 'builtin', type: 'string' },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template
      template: 'lower(${self})',
    });
    const builder = expressionBuilder(expr);

    expect(isParamPlaceholder(placeholder)).toBe(true);
    expect(isExpressionBuilder(builder)).toBe(true);
    expect(isExpressionSource(builder)).toBe(true);
    expect(isValueSource(builder)).toBe(true);
    expect(isValueSource(placeholder)).toBe(true);
  });

  it('derives expressions and base column info from operation expressions', () => {
    const expr = OperationExpr.function({
      method: 'lower',
      forTypeId: 'pg/text@1',
      self: ColumnRef.of('user', 'email'),
      args: [],
      returns: { kind: 'builtin', type: 'string' },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template
      template: 'lower(${self})',
    });
    const builder = expressionBuilder(expr);

    expect(builder.toExpr()).toBe(expr);
    expect(getColumnInfo(expr)).toEqual({ table: 'user', column: 'email' });
    expect(getColumnInfo(builder)).toEqual({ table: 'user', column: 'email' });
    expect(TableSource.named('user').collectRefs()).toEqual({ tables: ['user'], columns: [] });
  });
});
