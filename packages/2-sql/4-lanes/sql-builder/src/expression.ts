import type { QueryOperationTypesBase } from '@prisma-next/sql-contract/types';
import type {
  CodecExpression,
  Expression,
  RawSqlTag,
  TraitExpression,
} from '@prisma-next/sql-relational-core/expression';
import type { Expand, QueryContext, Scope, ScopeField, ScopeTable } from './scope';

export type { CodecExpression, Expression, RawSqlTag, TraitExpression };

export type BooleanCodecType = { codecId: 'pg/bool@1'; nullable: boolean };

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

export type ExpressionBuilder<AvailableScope extends Scope, QC extends QueryContext> = (
  fields: FieldProxy<AvailableScope>,
  fns: Functions<QC>,
) => Expression<BooleanCodecType>;

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

type DeriveExtFunctions<OT extends QueryOperationTypesBase> = {
  [K in keyof OT]: OT[K]['impl'];
};

// `BuiltinFunctions` was deleted in slice 3 of the unify-query-operations
// project: every trait-gated builtin (eq, neq, in, notIn, gt, gte, lt, lte,
// like, isNull, isNotNull, and, or, exists, notExists) now sources from the
// SQL-family registry via `DeriveExtFunctions<QC['queryOperationTypes']>`.
//
// `raw` is preserved as a top-level slot on `Functions<QC>` because its
// runtime impl depends on the adapter-supplied `RawCodecInferer` and so
// is wired through `createFunctions(operations, rawCodecInferer)` rather
// than registered as a family operation.
export type Functions<QC extends QueryContext> = {
  readonly raw: RawSqlTag;
} & DeriveExtFunctions<QC['queryOperationTypes']>;

export type CountField = { codecId: 'pg/int8@1'; nullable: false };

export type AggregateOnlyFunctions = {
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

export type AggregateFunctions<QC extends QueryContext> = Functions<QC> & AggregateOnlyFunctions;
