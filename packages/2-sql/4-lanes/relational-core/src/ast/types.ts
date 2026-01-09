import type { ReturnSpec } from '@prisma-next/operations';
import type { SqlLoweringSpec } from '@prisma-next/sql-operations';

// SQL-specific AST types and supporting types
// These types are needed by adapters and runtime for SQL query execution

export type Direction = 'asc' | 'desc';

export interface TableRef {
  readonly kind: 'table';
  readonly name: string;
}

export interface ColumnRef {
  readonly kind: 'col';
  readonly table: string;
  readonly column: string;
}

export interface ParamRef {
  readonly kind: 'param';
  readonly index: number;
  readonly name?: string;
}

export interface LiteralExpr {
  readonly kind: 'literal';
  readonly value: unknown;
}

export interface OperationExpr {
  readonly kind: 'operation';
  readonly method: string;
  readonly forTypeId: string;
  readonly self: Expression;
  readonly args: ReadonlyArray<Expression | ParamRef | LiteralExpr>;
  readonly returns: ReturnSpec;
  readonly lowering: SqlLoweringSpec;
}

/**
 * Unified expression type - the canonical AST representation for column references
 * and operation expressions. This is what all builders convert to via toExpr().
 */
export type Expression = ColumnRef | OperationExpr;

/**
 * Interface for any builder that can produce an Expression.
 * Implemented by ColumnBuilder and ExpressionBuilder.
 */
export interface ExpressionSource {
  toExpr(): Expression;
}

export function isOperationExpr(expr: Expression): expr is OperationExpr {
  return expr.kind === 'operation';
}

export type BinaryOp = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte';

export interface BinaryExpr {
  readonly kind: 'bin';
  readonly op: BinaryOp;
  readonly left: Expression;
  readonly right: Expression | ParamRef;
}

export interface ExistsExpr {
  readonly kind: 'exists';
  readonly not: boolean;
  readonly subquery: SelectAst;
}

/**
 * Unary expression for IS NULL / IS NOT NULL checks.
 * Used in WHERE clauses to check for null values.
 */
export interface NullCheckExpr {
  readonly kind: 'nullCheck';
  readonly expr: Expression;
  readonly isNull: boolean;
}

/**
 * Union type for WHERE clause expressions.
 */
export type WhereExpr = BinaryExpr | ExistsExpr | NullCheckExpr;

export type JoinOnExpr = {
  readonly kind: 'eqCol';
  readonly left: ColumnRef;
  readonly right: ColumnRef;
};

export interface JoinAst {
  readonly kind: 'join';
  readonly joinType: 'inner' | 'left' | 'right' | 'full';
  readonly table: TableRef;
  readonly on: JoinOnExpr;
}

export interface IncludeRef {
  readonly kind: 'includeRef';
  readonly alias: string;
}

export interface IncludeAst {
  readonly kind: 'includeMany';
  readonly alias: string;
  readonly child: {
    readonly table: TableRef;
    readonly on: JoinOnExpr;
    readonly where?: WhereExpr;
    readonly orderBy?: ReadonlyArray<{ expr: Expression; dir: Direction }>;
    readonly limit?: number;
    readonly project: ReadonlyArray<{ alias: string; expr: Expression }>;
  };
}

export interface SelectAst {
  readonly kind: 'select';
  readonly from: TableRef;
  readonly joins?: ReadonlyArray<JoinAst>;
  readonly includes?: ReadonlyArray<IncludeAst>;
  readonly project: ReadonlyArray<{
    alias: string;
    expr: Expression | IncludeRef | LiteralExpr;
  }>;
  readonly where?: WhereExpr;
  readonly orderBy?: ReadonlyArray<{ expr: Expression; dir: Direction }>;
  readonly limit?: number;
}

export interface InsertAst {
  readonly kind: 'insert';
  readonly table: TableRef;
  readonly values: Record<string, ColumnRef | ParamRef>;
  readonly returning?: ReadonlyArray<ColumnRef>;
}

export interface UpdateAst {
  readonly kind: 'update';
  readonly table: TableRef;
  readonly set: Record<string, ColumnRef | ParamRef>;
  readonly where: WhereExpr;
  readonly returning?: ReadonlyArray<ColumnRef>;
}

export interface DeleteAst {
  readonly kind: 'delete';
  readonly table: TableRef;
  readonly where: WhereExpr;
  readonly returning?: ReadonlyArray<ColumnRef>;
}

export type QueryAst = SelectAst | InsertAst | UpdateAst | DeleteAst;

export interface LoweredStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly annotations?: Record<string, unknown>;
}
