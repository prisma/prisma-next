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
} & {
  readonly [K in keyof TShape]: Column<TShape[K]>;
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
  select?: SelectClause;
  where?: WhereClause;
  orderBy?: OrderByClause[];
  limit?: LimitClause;
}

// Type inference helpers
export type InferSelectResult<TSelect extends Record<string, Column<any>>> = {
  [K in keyof TSelect]: TSelect[K] extends Column<infer U> ? U : never;
};

export type InferTableShape<TTable extends Table<any>> = TTable extends Table<infer TShape> ? TShape : never;

