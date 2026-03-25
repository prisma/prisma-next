import {
  ColumnRef,
  LiteralExpr,
  OperationExpr,
  ParamRef,
} from '@prisma-next/sql-relational-core/ast';
import { schema } from '@prisma-next/sql-relational-core/schema';
import {
  getColumnInfo,
  getColumnMeta,
  isColumnBuilder,
  isExpressionBuilder,
  isExpressionSource,
  isParamPlaceholder,
  isValueSource,
} from '@prisma-next/sql-relational-core/utils/guards';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../fixtures/contract.d';
import { createFixtureContext, loadFixtureContract } from '../test-helpers';

const vectorReturn = { kind: 'typeId', type: 'pg/vector@1' } as const;

function normalize(column: ColumnRef): OperationExpr {
  return OperationExpr.function({
    method: 'normalize',
    forTypeId: 'pg/vector@1',
    self: column,
    args: [],
    returns: vectorReturn,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template
    template: 'normalize(${self})',
  });
}

describe('guards', () => {
  const contract = loadFixtureContract<Contract>('contract');
  const context = createFixtureContext(contract);
  const tables = schema<Contract>(context).tables;

  it('reads column info from builders and operation expressions', () => {
    expect(getColumnInfo(tables.user.columns.id)).toEqual({ table: 'user', column: 'id' });
    expect(getColumnInfo(normalize(ColumnRef.of('user', 'embedding')))).toEqual({
      table: 'user',
      column: 'embedding',
    });
  });

  it('identifies builder and source shapes', () => {
    const builder = tables.user.columns.id;
    const expressionBuilder = {
      kind: 'expression' as const,
      expr: normalize(ColumnRef.of('user', 'embedding')),
      columnMeta: { nativeType: 'vector', codecId: 'pg/vector@1', nullable: false },
      eq: builder.eq,
      neq: builder.neq,
      gt: builder.gt,
      lt: builder.lt,
      gte: builder.gte,
      lte: builder.lte,
      asc: builder.asc,
      desc: builder.desc,
      toExpr: () => normalize(ColumnRef.of('user', 'embedding')),
      __jsType: undefined as never,
    };

    expect(isColumnBuilder(builder)).toBe(true);
    expect(isExpressionBuilder(expressionBuilder)).toBe(true);
    expect(isExpressionSource(builder)).toBe(true);
    expect(isExpressionSource(expressionBuilder)).toBe(true);
    expect(isValueSource(builder)).toBe(true);
    expect(isValueSource({ kind: 'param-placeholder', name: 'id' })).toBe(true);
  });

  it('converts sources to rich expressions', () => {
    const builder = tables.user.columns.id;
    expect(builder.toExpr()).toEqual(ColumnRef.of('user', 'id'));
  });

  it('extracts column metadata', () => {
    const builder = tables.user.columns.id;

    expect(getColumnMeta(builder)).toEqual({
      nativeType: 'int4',
      codecId: 'pg/int4@1',
      nullable: false,
    });
  });

  it('identifies param placeholders', () => {
    expect(isParamPlaceholder({ kind: 'param-placeholder', name: 'userId' })).toBe(true);
    expect(isParamPlaceholder({ kind: 'param-placeholder' })).toBe(false);
    expect(isParamPlaceholder(null)).toBe(false);
  });

  it('rejects plain values as builders or sources', () => {
    expect(isColumnBuilder({ kind: 'operation' })).toBe(false);
    expect(isExpressionBuilder({ kind: 'column' })).toBe(false);
    expect(isExpressionSource(LiteralExpr.of('x'))).toBe(false);
    expect(isValueSource(ParamRef.of('val1', { name: 'id' }))).toBe(false);
  });
});
