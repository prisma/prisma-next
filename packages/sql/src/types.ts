// Core type system for type-safe query building

import { Schema } from '@prisma/relational-ir';

// Type alias for schema IR
export type SchemaIR = Schema;

// Helper type for type-safe table names
export type TableName<TTables> = keyof TTables & string;

export interface Expression<T> {
  readonly __t?: T;
}

// Legacy types for backward compatibility during transition
export interface FieldExpression {
  type: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'in';
  field: string;
  value?: any;
  values?: any[];
}

export interface Column<T> extends Expression<T> {
  readonly table: string;
  readonly name: string;
  readonly __contractHash?: string;
  readonly __tsType?: T; // Brand for type inference
  eq(value: T): FieldExpression;
  ne(value: T): FieldExpression;
  gt(value: T): FieldExpression;
  lt(value: T): FieldExpression;
  gte(value: T): FieldExpression;
  lte(value: T): FieldExpression;
  in(values: T[]): FieldExpression;
}

export const TABLE_NAME = Symbol('tableName');

export type Table<TShape> = {
  readonly [TABLE_NAME]: string;
  readonly __contractHash?: string;
} & {
  readonly [K in keyof TShape]: Column<TShape[K]>;
} & {
  readonly [x: string]: Column<any>;
};

export interface Tables {
  readonly [tableName: string]: Table<any>;
}

// Legacy types for backward compatibility during transition
export interface SelectClause {
  type: 'select';
  fields: Record<string, Column<any>>;
}

export interface WhereClause {
  type: 'where';
  condition: FieldExpression;
}

export interface OrderByClause {
  type: 'orderBy';
  field: string;
  direction: 'ASC' | 'DESC';
}

export interface LimitClause {
  type: 'limit';
  count: number;
}

export interface QueryAST {
  type: 'select';
  from: string;
  contractHash?: string;
  projectStar?: boolean;
  select?: SelectClause | ProjectionItem[]; // Support both old and new format
  where?: WhereClause;
  joins?: JoinClause[]; // NEW: for N:1 includes
  orderBy?: OrderByClause[];
  limit?: LimitClause;
}

// Raw SQL AST types
export type Dialect = 'postgres' | 'mysql' | 'sqlite' | '*';

export type TemplatePiece =
  | { kind: 'text'; value: string }
  | { kind: 'value'; v: any; codec?: string }
  | { kind: 'ident'; name: string }
  | { kind: 'qualified'; parts: string[] }
  | { kind: 'column'; table?: string; name: string }
  | { kind: 'table'; name: string }
  | { kind: 'rawUnsafe'; sql: string };

export interface RawQueryAST {
  type: 'raw';
  template: TemplatePiece[];
  dialect?: Dialect;
  intent?: 'read' | 'write' | 'ddl' | 'unknown';
  annotations?: Record<string, any>;
}

export interface ExprRaw {
  kind: 'raw';
  template: TemplatePiece[];
  dialect?: Dialect;
}

// Union type for all query AST types
export type QueryASTUnion = QueryAST | RawQueryAST;

export interface Plan<TResult = never> {
  ast: QueryASTUnion;
  sql: string;
  params: unknown[];
  meta: {
    contractHash: string;
    target: 'postgres';
    refs: { tables: string[]; columns: string[] };
    paramsShape?: Array<{ name?: string; type?: string }>;
    annotations?: Record<string, any>;
  };
}

// Helper function to create raw SQL Plan
/**
 * @deprecated Use raw() or rawQuery() from the new raw SQL API instead
 */
export function rawSql(sql: string): Plan<unknown> {
  return {
    ast: { type: 'select', from: '', projectStar: true } as any, // Dummy AST for raw SQL
    sql,
    params: [],
    meta: {
      contractHash: '',
      target: 'postgres',
      refs: { tables: [], columns: [] },
    },
  };
}

// Type inference helpers
export type InferSelectResult<TSelect extends Record<string, Column<any>>> = {
  [K in keyof TSelect]: TSelect[K] extends Column<infer U> ? U : never;
};

export type InferTableShape<TTable extends Table<any>> =
  TTable extends Table<infer TShape> ? TShape : never;

// Contract hash verification configuration
export type ContractMismatchMode = 'error' | 'warn';

// Expression types for flexible projections
export type Expr =
  | { kind: 'column'; table?: string; name: string }
  | { kind: 'call'; fn: string; args: Expr[] } // json_agg, coalesce, etc.
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'subquery'; query: QueryAST } // correlated subqueries
  | { kind: 'jsonObject'; fields: Record<string, Expr> } // json_build_object helper
  | ExprRaw; // raw SQL expressions

// Projection item
export interface ProjectionItem {
  alias: string;
  expr: Expr;
}

// JOIN support (for N:1 includes)
export interface JoinClause {
  type: 'join' | 'leftJoin';
  table: string;
  alias?: string;
  on: FieldExpression | { type: 'literal'; value: string };
}

// Forward declaration for FromBuilder
export interface FromBuilder<TTable extends Table<any>, TResult = never> {
  select<TSelect extends Record<string, Column<any>>>(fields: TSelect): any; // QueryBuilder will be imported from builder.ts
  selectRaw(projections: ProjectionItem[]): any; // For raw expressions
  where(condition: FieldExpression): FromBuilder<TTable, TResult>;
  orderBy(field: string, direction?: 'ASC' | 'DESC'): FromBuilder<TTable, TResult>;
  limit(count: number): FromBuilder<TTable, TResult>;
  build(): Plan<TResult>;
}
