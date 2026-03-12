import type { StorageTable } from '@prisma-next/sql-contract/types';

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;
export declare const RowType: unique symbol;
export declare const Scope: unique symbol;
export declare const ExpressionType: unique symbol;

type Expand<T> = { [K in keyof T]: T[K] } & unknown;

export type ScopeRecord = { codecId: string; nullable: boolean };
export type Scope = Record<string, ScopeRecord>;

export type ScopeHolder<T> = {
  [Scope]: T;
};

export type Expression<T extends ScopeRecord> = {
  [ExpressionType]: T;
};

export type DefaultScope<T extends StorageTable> = {
  [K in keyof T['columns']]: {
    codecId: T['columns'][K]['codecId'];
    nullable: T['columns'][K]['nullable'];
  };
};

export type WithField<Source, FromScope extends Scope, Column extends keyof FromScope> = Expand<
  Source & { [K in Column]: FromScope[K] }
>;

export type FieldProxy<AvailableScope extends Scope> = {
  [K in keyof AvailableScope]: Expression<AvailableScope[K]>;
};

export type ExpressionOrValue<
  T extends ScopeRecord,
  CT extends Record<string, { readonly input: unknown }>,
> = Expression<T> | (T['codecId'] extends keyof CT ? CT[T['codecId']]['input'] : never);

export type BooleanCodecType = { codecId: 'pg/bool@1'; nullable: boolean };

export type ExpressionBuilder<
  AvailableScope extends Scope,
  CT extends Record<string, { readonly input: unknown }>,
> = (fields: FieldProxy<AvailableScope>, fns: Functions<CT>) => Expression<BooleanCodecType>;

export type Functions<CT extends Record<string, { readonly input: unknown }>> = {
  eq: <CodecId extends string>(
    a: ExpressionOrValue<{ codecId: CodecId; nullable: boolean }, CT>,
    b: ExpressionOrValue<{ codecId: CodecId; nullable: boolean }, CT>,
  ) => Expression<BooleanCodecType>;
  ne: <T extends ScopeRecord>(
    a: ExpressionOrValue<T, CT>,
    b: ExpressionOrValue<T, CT>,
  ) => Expression<BooleanCodecType>;
  gt: <T extends ScopeRecord>(
    a: ExpressionOrValue<T, CT>,
    b: ExpressionOrValue<T, CT>,
  ) => Expression<BooleanCodecType>;
  gte: <T extends ScopeRecord>(
    a: ExpressionOrValue<T, CT>,
    b: ExpressionOrValue<T, CT>,
  ) => Expression<BooleanCodecType>;
  lt: <T extends ScopeRecord>(
    a: ExpressionOrValue<T, CT>,
    b: ExpressionOrValue<T, CT>,
  ) => Expression<BooleanCodecType>;
  lte: <T extends ScopeRecord>(
    a: ExpressionOrValue<T, CT>,
    b: ExpressionOrValue<T, CT>,
  ) => Expression<BooleanCodecType>;
  and: (...ands: ExpressionOrValue<BooleanCodecType, CT>[]) => Expression<BooleanCodecType>;
  or: (...ors: ExpressionOrValue<BooleanCodecType, CT>[]) => Expression<BooleanCodecType>;
};

export type ResolveRow<
  Row extends Record<string, ScopeRecord>,
  CodecTypes extends Record<string, { readonly output: unknown }>,
> = Expand<{
  -readonly [K in keyof Row]: Row[K]['codecId'] extends keyof CodecTypes
    ? Row[K]['nullable'] extends true
      ? CodecTypes[Row[K]['codecId']]['output'] | null
      : CodecTypes[Row[K]['codecId']]['output']
    : unknown;
}>;

type NullableScope<S extends Scope> = {
  [K in keyof S]: { codecId: S[K]['codecId']; nullable: true };
};

export interface SelectBuilder<
  CodecTypes extends CodecTypesBase,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeRecord> = {},
> extends ScopeHolder<AvailableScope> {
  innerJoin<OtherScope extends Scope>(
    other: ScopeHolder<OtherScope>,
    on: ExpressionBuilder<AvailableScope & OtherScope, CodecTypes>,
  ): SelectBuilder<CodecTypes, AvailableScope & OtherScope, RowType>;

  outerLeftJoin<OtherScope extends Scope>(
    other: ScopeHolder<OtherScope>,
    on: ExpressionBuilder<AvailableScope & OtherScope, CodecTypes>,
  ): SelectBuilder<CodecTypes, AvailableScope & NullableScope<OtherScope>, RowType>;

  outerRightJoin<OtherScope extends Scope>(
    other: ScopeHolder<OtherScope>,
    on: ExpressionBuilder<AvailableScope & OtherScope, CodecTypes>,
  ): SelectBuilder<CodecTypes, NullableScope<AvailableScope> & OtherScope, RowType>;

  outerFullJoin<OtherScope extends Scope>(
    other: ScopeHolder<OtherScope>,
    on: ExpressionBuilder<AvailableScope & OtherScope, CodecTypes>,
  ): SelectBuilder<CodecTypes, NullableScope<AvailableScope> & NullableScope<OtherScope>, RowType>;

  select<Column extends keyof AvailableScope>(
    column: Column,
  ): SelectBuilder<CodecTypes, AvailableScope, WithField<RowType, AvailableScope, Column>>;

  where(
    expr: ExpressionBuilder<AvailableScope, CodecTypes>,
  ): SelectBuilder<CodecTypes, AvailableScope, RowType>;

  first(): Promise<ResolveRow<RowType, CodecTypes>>;
}
