import type { StorageColumn } from '@prisma-next/sql-contract/types';
import type {
  ColumnRef,
  Expression,
  ExpressionSource,
  LiteralExpr,
  OperationExpr,
  ParamRef,
} from '../ast/types';
import type {
  AnyColumnBuilder,
  AnyExpressionSource,
  ExpressionBuilder,
  ParamPlaceholder,
  ValueSource,
} from '../types';

/**
 * Helper to extract columnMeta from a ColumnBuilder or ExpressionBuilder.
 * Returns StorageColumn if present, undefined otherwise.
 * Both ColumnBuilder and ExpressionBuilder have columnMeta property.
 */
export function getColumnMeta(expr: AnyExpressionSource): StorageColumn | undefined {
  // Both ColumnBuilder and ExpressionBuilder have columnMeta: StorageColumn
  // TypeScript should narrow the type after the 'in' check
  if ('columnMeta' in expr) {
    return expr.columnMeta;
  }
  return undefined;
}

/**
 * Type predicate to check if a value is a ParamPlaceholder.
 */
export function isParamPlaceholder(value: unknown): value is ParamPlaceholder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'param-placeholder' &&
    'name' in value &&
    typeof (value as { name: unknown }).name === 'string'
  );
}

/**
 * Recursively extracts the base ColumnRef from an OperationExpr.
 * If the expression is already a ColumnRef, it is returned directly.
 */
export function extractBaseColumnRef(expr: ColumnRef | OperationExpr): ColumnRef {
  if (expr.kind === 'col') {
    return expr;
  }
  return extractBaseColumnRef(expr.self);
}

/**
 * Recursively collects all ColumnRef nodes from an expression tree.
 * Handles nested OperationExpr structures by traversing both self and args.
 */
export function collectColumnRefs(
  expr: ColumnRef | ParamRef | LiteralExpr | OperationExpr,
): ColumnRef[] {
  if (expr.kind === 'col') {
    return [expr];
  }
  if (expr.kind === 'operation') {
    const refs: ColumnRef[] = collectColumnRefs(expr.self);
    for (const arg of expr.args) {
      refs.push(...collectColumnRefs(arg));
    }
    return refs;
  }
  return [];
}

/**
 * Type predicate to check if an expression is an OperationExpr.
 */
export function isOperationExpr(
  expr: AnyExpressionSource | OperationExpr | Expression,
): expr is OperationExpr {
  return typeof expr === 'object' && expr !== null && 'kind' in expr && expr.kind === 'operation';
}

/**
 * Helper to extract table and column from a ColumnBuilder, ExpressionBuilder, or OperationExpr.
 * For ExpressionBuilder or OperationExpr, recursively unwraps to find the base ColumnRef.
 */
export function getColumnInfo(expr: AnyExpressionSource | OperationExpr): {
  table: string;
  column: string;
} {
  if (isOperationExpr(expr)) {
    const baseCol = extractBaseColumnRef(expr);
    return { table: baseCol.table, column: baseCol.column };
  }
  if (isExpressionBuilder(expr)) {
    const baseCol = extractBaseColumnRef(expr.expr);
    return { table: baseCol.table, column: baseCol.column };
  }
  // expr is ColumnBuilder - TypeScript can't narrow properly
  const colBuilder = expr as unknown as { table: string; column: string };
  return { table: colBuilder.table, column: colBuilder.column };
}

/**
 * Type predicate to check if a value is a ColumnBuilder.
 */
export function isColumnBuilder(value: unknown): value is AnyColumnBuilder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'column'
  );
}

/**
 * Type predicate to check if a value is an ExpressionBuilder.
 */
export function isExpressionBuilder(value: unknown): value is ExpressionBuilder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'expression'
  );
}

/**
 * Type predicate to check if a value is an ExpressionSource (has toExpr method).
 */
export function isExpressionSource(value: unknown): value is ExpressionSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toExpr' in value &&
    typeof (value as ExpressionSource).toExpr === 'function'
  );
}

/**
 * Converts any ExpressionSource to an Expression.
 * This is the canonical way to get an AST Expression from a builder.
 *
 * @param source - A ColumnBuilder or ExpressionBuilder
 * @returns The corresponding Expression (ColumnRef or OperationExpr)
 */
export function toExpression(source: ExpressionSource): Expression {
  return source.toExpr();
}

/**
 * Converts an AnyExpressionSource to an Expression.
 * Handles both ColumnBuilder and ExpressionBuilder.
 *
 * @param source - A ColumnBuilder or ExpressionBuilder
 * @returns The corresponding Expression (ColumnRef or OperationExpr)
 */
export function expressionFromSource(source: AnyExpressionSource): Expression {
  return source.toExpr();
}

/**
 * Type predicate to check if a value is a ValueSource.
 * ValueSource is either a ParamPlaceholder or an ExpressionSource.
 */
export function isValueSource(value: unknown): value is ValueSource {
  return isParamPlaceholder(value) || isExpressionSource(value);
}
