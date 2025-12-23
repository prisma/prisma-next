import { planInvalid } from '@prisma-next/plan';
import type { StorageColumn } from '@prisma-next/sql-contract/types';
import type { BinaryOp, ColumnRef, OperationExpr } from './ast/types';
import type {
  AnyColumnBuilderBase,
  BinaryBuilder,
  ExpressionBuilder,
  OrderBuilder,
  ParamPlaceholder,
} from './types';

/**
 * Creates an ExpressionBuilder from a ColumnRef or OperationExpr.
 * This is the factory function for creating expression nodes that can be used
 * in query building (projections, WHERE clauses, ORDER BY, etc.).
 */
export function createExpressionBuilder<
  ColumnName extends string,
  ColumnMeta extends StorageColumn,
  JsType = unknown,
>(
  expr: ColumnRef | OperationExpr,
  columnMeta: ColumnMeta,
): ExpressionBuilder<ColumnName, ColumnMeta, JsType> {
  const expressionBuilder: ExpressionBuilder<ColumnName, ColumnMeta, JsType> = {
    kind: 'expression' as const,
    expr,
    columnMeta,
    eq(
      value: ParamPlaceholder | AnyColumnBuilderBase,
    ): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
      if (value == null) {
        throw planInvalid(
          'Parameter placeholder or column builder required for expression comparison',
        );
      }
      if (value.kind === 'param-placeholder' || value.kind === 'column') {
        return Object.freeze({
          kind: 'binary' as const,
          op: 'eq' as BinaryOp,
          left: expressionBuilder,
          right: value,
        }) as BinaryBuilder<ColumnName, ColumnMeta, JsType>;
      }
      throw planInvalid(
        'Parameter placeholder or column builder required for expression comparison',
      );
    },
    neq(
      value: ParamPlaceholder | AnyColumnBuilderBase,
    ): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
      if (value == null) {
        throw planInvalid(
          'Parameter placeholder or column builder required for expression comparison',
        );
      }
      if (value.kind === 'param-placeholder' || value.kind === 'column') {
        return Object.freeze({
          kind: 'binary' as const,
          op: 'neq' as BinaryOp,
          left: expressionBuilder,
          right: value,
        }) as BinaryBuilder<ColumnName, ColumnMeta, JsType>;
      }
      throw planInvalid(
        'Parameter placeholder or column builder required for expression comparison',
      );
    },
    gt(
      value: ParamPlaceholder | AnyColumnBuilderBase,
    ): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
      if (value == null) {
        throw planInvalid(
          'Parameter placeholder or column builder required for expression comparison',
        );
      }
      if (value.kind === 'param-placeholder' || value.kind === 'column') {
        return Object.freeze({
          kind: 'binary' as const,
          op: 'gt' as BinaryOp,
          left: expressionBuilder,
          right: value,
        }) as BinaryBuilder<ColumnName, ColumnMeta, JsType>;
      }
      throw planInvalid(
        'Parameter placeholder or column builder required for expression comparison',
      );
    },
    lt(
      value: ParamPlaceholder | AnyColumnBuilderBase,
    ): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
      if (value == null) {
        throw planInvalid(
          'Parameter placeholder or column builder required for expression comparison',
        );
      }
      if (value.kind === 'param-placeholder' || value.kind === 'column') {
        return Object.freeze({
          kind: 'binary' as const,
          op: 'lt' as BinaryOp,
          left: expressionBuilder,
          right: value,
        }) as BinaryBuilder<ColumnName, ColumnMeta, JsType>;
      }
      throw planInvalid(
        'Parameter placeholder or column builder required for expression comparison',
      );
    },
    gte(
      value: ParamPlaceholder | AnyColumnBuilderBase,
    ): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
      if (value == null) {
        throw planInvalid(
          'Parameter placeholder or column builder required for expression comparison',
        );
      }
      if (value.kind === 'param-placeholder' || value.kind === 'column') {
        return Object.freeze({
          kind: 'binary' as const,
          op: 'gte' as BinaryOp,
          left: expressionBuilder,
          right: value,
        }) as BinaryBuilder<ColumnName, ColumnMeta, JsType>;
      }
      throw planInvalid(
        'Parameter placeholder or column builder required for expression comparison',
      );
    },
    lte(
      value: ParamPlaceholder | AnyColumnBuilderBase,
    ): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
      if (value == null) {
        throw planInvalid(
          'Parameter placeholder or column builder required for expression comparison',
        );
      }
      if (value.kind === 'param-placeholder' || value.kind === 'column') {
        return Object.freeze({
          kind: 'binary' as const,
          op: 'lte' as BinaryOp,
          left: expressionBuilder,
          right: value,
        }) as BinaryBuilder<ColumnName, ColumnMeta, JsType>;
      }
      throw planInvalid(
        'Parameter placeholder or column builder required for expression comparison',
      );
    },
    asc(): OrderBuilder<ColumnName, ColumnMeta, JsType> {
      return Object.freeze({
        kind: 'order' as const,
        expr: expressionBuilder,
        dir: 'asc' as const,
      }) as OrderBuilder<ColumnName, ColumnMeta, JsType>;
    },
    desc(): OrderBuilder<ColumnName, ColumnMeta, JsType> {
      return Object.freeze({
        kind: 'order' as const,
        expr: expressionBuilder,
        dir: 'desc' as const,
      }) as OrderBuilder<ColumnName, ColumnMeta, JsType>;
    },
    get __jsType(): JsType {
      return undefined as unknown as JsType;
    },
  };

  return Object.freeze(expressionBuilder);
}

/**
 * Converts a ColumnBuilder to an ExpressionBuilder.
 * This extracts the ColumnRef from the builder and wraps it in an ExpressionBuilder.
 */
export function columnToExpression<
  ColumnName extends string,
  ColumnMeta extends StorageColumn,
  JsType = unknown,
>(builder: {
  readonly table: string;
  readonly column: ColumnName;
  readonly columnMeta: ColumnMeta;
}): ExpressionBuilder<ColumnName, ColumnMeta, JsType> {
  const columnRef: ColumnRef = {
    kind: 'col',
    table: builder.table,
    column: builder.column,
  };
  return createExpressionBuilder(columnRef, builder.columnMeta);
}
