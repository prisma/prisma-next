import type { Expand, ExpressionType, Scope, ScopeField, ScopeTable } from './scope';

export type Expression<T extends ScopeField> = {
  [ExpressionType]: T;
};

export type WithField<Source, Field extends ScopeField, Alias extends string> = Expand<
  Source & { [K in Alias]: Field }
>;

export type WithFields<
  Source,
  FromScope extends ScopeTable,
  Columns extends readonly (keyof FromScope)[],
> = Expand<Source & Pick<FromScope, Columns[number]>>;

export type ExtractScopeFields<T extends Record<string, Expression<ScopeField>>> = {
  [K in keyof T]: T[K] extends Expression<infer F extends ScopeField> ? F : never;
};

export type FieldProxy<AvailableScope extends Scope> = {
  [K in keyof AvailableScope['topLevel']]: Expression<AvailableScope['topLevel'][K]>;
} & {
  [TableName in keyof AvailableScope['namespaces']]: {
    [K in keyof AvailableScope['namespaces'][TableName]]: Expression<
      AvailableScope['namespaces'][TableName][K]
    >;
  };
};

export type ExpressionOrValue<
  T extends ScopeField,
  CT extends Record<string, { readonly input: unknown }>,
> = Expression<T> | (T['codecId'] extends keyof CT ? CT[T['codecId']]['input'] : never);

export type BooleanCodecType = { codecId: 'pg/bool@1'; nullable: boolean };

export type ExpressionBuilder<
  AvailableScope extends Scope,
  CT extends Record<string, { readonly input: unknown }>,
> = (fields: FieldProxy<AvailableScope>, fns: Functions<CT>) => Expression<BooleanCodecType>;

export type OrderByDirection = 'asc' | 'desc';
export type OrderByNulls = 'first' | 'last';

export type OrderByOptions = {
  direction?: OrderByDirection;
  nulls?: OrderByNulls;
};

export type OrderByScope<
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> = {
  topLevel: Expand<AvailableScope['topLevel'] & RowType>;
  namespaces: AvailableScope['namespaces'];
};

export type Functions<CT extends Record<string, { readonly input: unknown }>> = {
  eq: <CodecId extends string>(
    a: ExpressionOrValue<{ codecId: CodecId; nullable: boolean }, CT>,
    b: ExpressionOrValue<{ codecId: CodecId; nullable: boolean }, CT>,
  ) => Expression<BooleanCodecType>;
  ne: <T extends ScopeField>(
    a: ExpressionOrValue<T, CT>,
    b: ExpressionOrValue<T, CT>,
  ) => Expression<BooleanCodecType>;
  gt: <T extends ScopeField>(
    a: ExpressionOrValue<T, CT>,
    b: ExpressionOrValue<T, CT>,
  ) => Expression<BooleanCodecType>;
  gte: <T extends ScopeField>(
    a: ExpressionOrValue<T, CT>,
    b: ExpressionOrValue<T, CT>,
  ) => Expression<BooleanCodecType>;
  lt: <T extends ScopeField>(
    a: ExpressionOrValue<T, CT>,
    b: ExpressionOrValue<T, CT>,
  ) => Expression<BooleanCodecType>;
  lte: <T extends ScopeField>(
    a: ExpressionOrValue<T, CT>,
    b: ExpressionOrValue<T, CT>,
  ) => Expression<BooleanCodecType>;
  and: (...ands: ExpressionOrValue<BooleanCodecType, CT>[]) => Expression<BooleanCodecType>;
  or: (...ors: ExpressionOrValue<BooleanCodecType, CT>[]) => Expression<BooleanCodecType>;
};

export type CountField = { codecId: 'pg/int8@1'; nullable: false };

export type AggregateFunctions<CT extends Record<string, { readonly input: unknown }>> =
  Functions<CT> & {
    count: (expr?: Expression<ScopeField>) => Expression<CountField>;
    sum: <T extends ScopeField>(
      expr: Expression<T>,
    ) => Expression<{ codecId: T['codecId']; nullable: true }>;
    avg: <T extends ScopeField>(
      expr: Expression<T>,
    ) => Expression<{ codecId: T['codecId']; nullable: true }>;
    min: <T extends ScopeField>(
      expr: Expression<T>,
    ) => Expression<{ codecId: T['codecId']; nullable: true }>;
    max: <T extends ScopeField>(
      expr: Expression<T>,
    ) => Expression<{ codecId: T['codecId']; nullable: true }>;
  };
