import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { ReturnSpec } from '@prisma-next/operations';
import type { SqlLoweringSpec } from '@prisma-next/sql-operations';

// SQL-specific AST types and supporting types
// These types are needed by adapters and runtime for SQL query execution

export type Direction = 'asc' | 'desc';

export interface TableSource {
  readonly kind: 'table';
  readonly name: string;
  readonly alias?: string;
}

export type TableRef = TableSource;

export interface DerivedTableSource {
  readonly kind: 'derivedTable';
  readonly alias: string;
  readonly query: SelectAst;
}

export type FromSource = TableSource | DerivedTableSource;

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

export interface DefaultValueExpr {
  readonly kind: 'default';
}

export interface LiteralExpr {
  readonly kind: 'literal';
  readonly value: unknown;
}

export interface SubqueryExpr {
  readonly kind: 'subquery';
  readonly query: SelectAst;
}

export interface JsonObjectExpr {
  readonly kind: 'jsonObject';
  readonly entries: ReadonlyArray<{
    readonly key: string;
    readonly value: Expression | LiteralExpr;
  }>;
}

export interface JsonArrayAggExpr {
  readonly kind: 'jsonArrayAgg';
  readonly expr: Expression;
  readonly onEmpty: 'null' | 'emptyArray';
  readonly orderBy?: ReadonlyArray<OrderByItem>;
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
export type Expression =
  | ColumnRef
  | OperationExpr
  | SubqueryExpr
  | AggregateExpr
  | JsonObjectExpr
  | JsonArrayAggExpr;

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

export type BinaryOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'like'
  | 'ilike'
  | 'in'
  | 'notIn';

export interface BinaryExpr {
  readonly kind: 'bin';
  readonly op: BinaryOp;
  readonly left: Expression;
  readonly right: Expression | ParamRef | LiteralExpr | ListLiteralExpr;
}

export interface ListLiteralExpr {
  readonly kind: 'listLiteral';
  readonly values: ReadonlyArray<ParamRef | LiteralExpr>;
}

export interface AndExpr {
  readonly kind: 'and';
  readonly exprs: ReadonlyArray<WhereExpr>;
}

export interface OrExpr {
  readonly kind: 'or';
  readonly exprs: ReadonlyArray<WhereExpr>;
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
export type WhereExpr = BinaryExpr | ExistsExpr | NullCheckExpr | AndExpr | OrExpr;

export interface BoundWhereExpr {
  readonly expr: WhereExpr;
  readonly params: readonly unknown[];
  readonly paramDescriptors: ReadonlyArray<ParamDescriptor>;
}

export interface ToWhereExpr {
  toWhereExpr(): BoundWhereExpr;
}

export type WhereArg = WhereExpr | ToWhereExpr;

export type JoinOnExpr =
  | {
      readonly kind: 'eqCol';
      readonly left: ColumnRef;
      readonly right: ColumnRef;
    }
  | WhereExpr;

export interface JoinAst {
  readonly kind: 'join';
  readonly joinType: 'inner' | 'left' | 'right' | 'full';
  readonly source: FromSource;
  readonly lateral: boolean;
  readonly on: JoinOnExpr;
}

export type AggregateCountFn = 'count';
export type AggregateOpFn = 'sum' | 'avg' | 'min' | 'max';
export type AggregateFn = AggregateCountFn | AggregateOpFn;

export interface AggregateCountExpr {
  readonly kind: 'aggregate';
  readonly fn: AggregateCountFn;
  readonly expr?: Expression;
}

export interface AggregateOpExpr {
  readonly kind: 'aggregate';
  readonly fn: AggregateOpFn;
  readonly expr: Expression;
}

export type AggregateExpr = AggregateCountExpr | AggregateOpExpr;

export interface ProjectionItem {
  readonly alias: string;
  readonly expr: Expression | LiteralExpr;
}

export interface OrderByItem {
  readonly expr: Expression;
  readonly dir: Direction;
}

export interface SelectAst {
  readonly kind: 'select';
  readonly from: FromSource;
  readonly joins?: ReadonlyArray<JoinAst>;
  readonly project: ReadonlyArray<ProjectionItem>;
  readonly where?: WhereExpr;
  readonly orderBy?: ReadonlyArray<OrderByItem>;
  readonly distinct?: true;
  readonly distinctOn?: ReadonlyArray<Expression>;
  readonly groupBy?: ReadonlyArray<Expression>;
  readonly having?: WhereExpr;
  readonly limit?: number;
  readonly offset?: number;
  readonly selectAllIntent?: { table?: string };
}

export interface InsertOnConflictAst {
  readonly columns: ReadonlyArray<ColumnRef>;
  readonly action:
    | {
        readonly kind: 'doNothing';
      }
    | {
        readonly kind: 'doUpdateSet';
        readonly set: Record<string, ColumnRef | ParamRef>;
      };
}

export interface InsertAst {
  readonly kind: 'insert';
  readonly table: TableSource;
  readonly rows: ReadonlyArray<Record<string, InsertValue>>;
  readonly onConflict?: InsertOnConflictAst;
  readonly returning?: ReadonlyArray<ColumnRef>;
}

export type InsertValue = ColumnRef | ParamRef | DefaultValueExpr;

export interface UpdateAst {
  readonly kind: 'update';
  readonly table: TableSource;
  readonly set: Record<string, ColumnRef | ParamRef>;
  readonly where?: WhereExpr;
  readonly returning?: ReadonlyArray<ColumnRef>;
}

export interface DeleteAst {
  readonly kind: 'delete';
  readonly table: TableSource;
  readonly where?: WhereExpr;
  readonly returning?: ReadonlyArray<ColumnRef>;
}

export type QueryAst = SelectAst | InsertAst | UpdateAst | DeleteAst;

export interface LoweredStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly annotations?: Record<string, unknown>;
}
