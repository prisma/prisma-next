import type {
  ColumnRef,
  LiteralExpr,
  OperationExpr,
  ParamRef,
} from '@prisma-next/sql-relational-core/ast';
import type {
  AnyColumnBuilder,
  AnyPredicateBuilder,
  BinaryBuilder,
  LogicalBuilder,
} from '@prisma-next/sql-relational-core/types';

export function extractBaseColumnRef(expr: ColumnRef | OperationExpr): ColumnRef {
  if (expr.kind === 'col') {
    return expr;
  }
  return extractBaseColumnRef(expr.self);
}

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

export function isOperationExpr(expr: AnyColumnBuilder | OperationExpr): expr is OperationExpr {
  return typeof expr === 'object' && expr !== null && 'kind' in expr && expr.kind === 'operation';
}

export function getColumnInfo(expr: AnyColumnBuilder | OperationExpr): {
  table: string;
  column: string;
} {
  if (isOperationExpr(expr)) {
    const baseCol = extractBaseColumnRef(expr);
    return { table: baseCol.table, column: baseCol.column };
  }
  const colBuilder = expr as unknown as { table: string; column: string };
  return { table: colBuilder.table, column: colBuilder.column };
}

export function isColumnBuilder(value: unknown): value is AnyColumnBuilder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'column'
  );
}

/**
 * Recursively collects column info from all BinaryBuilder nodes in a predicate builder tree.
 * Traverses LogicalBuilder nodes to collect columns from both left and right sides.
 * Handles OperationExpr by collecting all column references from the operation expression.
 */
export function collectColumnInfoFromPredicate(
  predicate: AnyPredicateBuilder,
): Array<{ table: string; column: string }> {
  const results: Array<{ table: string; column: string }> = [];

  function traverse(p: AnyPredicateBuilder): void {
    if (p.kind === 'binary') {
      const binary = p as BinaryBuilder;
      const left = binary.left;
      // Check if left is a ColumnBuilder with an operation expression
      const operationExpr = (left as { _operationExpr?: OperationExpr })._operationExpr;
      if (operationExpr) {
        // Collect all column references from the operation expression
        const allRefs = collectColumnRefs(operationExpr);
        for (const ref of allRefs) {
          results.push({ table: ref.table, column: ref.column });
        }
      } else {
        // Regular ColumnBuilder - extract column info directly
        const colInfo = getColumnInfo(left);
        results.push(colInfo);
      }
    } else if (p.kind === 'logical') {
      const logical = p as LogicalBuilder;
      // Recursively traverse both left and right sides
      traverse(logical.left);
      traverse(logical.right);
    }
  }

  traverse(predicate);
  return results;
}
