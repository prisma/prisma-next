// Core type system for type-safe query building

export interface Expression<T> {
  readonly __t?: T;
}

export interface Column<T> extends Expression<T> {
  readonly table: string;
  readonly name: string;
  eq(value: T): Expression<boolean>;
  ne(value: T): Expression<boolean>;
  gt(value: T): Expression<boolean>;
  lt(value: T): Expression<boolean>;
  gte(value: T): Expression<boolean>;
  lte(value: T): Expression<boolean>;
  in(values: T[]): Expression<boolean>;
}

export type Table<TShape> = {
  readonly name: string;
} & {
  readonly [K in keyof TShape]: Column<TShape[K]>;
};

export interface Tables {
  readonly [tableName: string]: Table<any>;
}

// Legacy types for backward compatibility during transition
export interface FieldExpression {
  type: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'in';
  field: string;
  value?: any;
  values?: any[];
}

export interface SelectClause {
  type: 'select';
  fields: Record<string, Column<any>>;
}

export interface WhereClause {
  type: 'where';
  condition: Expression<boolean>;
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

