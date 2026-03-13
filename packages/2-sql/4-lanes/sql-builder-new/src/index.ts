import type { StorageTable } from '@prisma-next/sql-contract/types';

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;
export declare const ExpressionType: unique symbol;
export declare const JoinOuterScope: unique symbol;

type Expand<T> = { [K in keyof T]: T[K] } & unknown;
type EmptyRow = Record<never, ScopeField>;

export type ScopeField = { codecId: string; nullable: boolean };
export type ScopeTable = Record<string, ScopeField>;

export type Scope = {
  topLevel: ScopeTable;
  namespaces: Record<string, ScopeTable>;
};

export type JoinSource<Row extends ScopeTable, Alias extends string> = {
  [JoinOuterScope]: {
    topLevel: Row;
    namespaces: Record<Alias, Row>;
  };
};

export type Expression<T extends ScopeField> = {
  [ExpressionType]: T;
};

export type DefaultScope<Name extends string, Table extends StorageTable> = {
  topLevel: StorageTableToScopeTable<Table>;
  namespaces: {
    [K in Name]: StorageTableToScopeTable<Table>;
  };
};

export type StorageTableToScopeTable<T extends StorageTable> = {
  [K in keyof T['columns']]: {
    codecId: T['columns'][K]['codecId'];
    nullable: T['columns'][K]['nullable'];
  };
};

type WithField<Source, Field extends ScopeField, Alias extends string> = Expand<
  Source & { [K in Alias]: Field }
>;

type WithFields<
  Source,
  FromScope extends ScopeTable,
  Columns extends readonly (keyof FromScope)[],
> = Expand<Source & Pick<FromScope, Columns[number]>>;

type ExtractScopeFields<T extends Record<string, Expression<ScopeField>>> = {
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

export type MergeScopes<A extends Scope, B extends Scope> = {
  topLevel: Expand<
    Omit<A['topLevel'], keyof B['topLevel']> & Omit<B['topLevel'], keyof A['topLevel']>
  >;
  namespaces: Expand<A['namespaces'] & B['namespaces']>;
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

type OrderByDirection = 'asc' | 'desc';
type OrderByNulls = 'first' | 'last';

type OrderByOptions = {
  direction?: OrderByDirection;
  nulls?: OrderByNulls;
};

type OrderByScope<AvailableScope extends Scope, RowType extends Record<string, ScopeField>> = {
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

/// Given a row type of { <fieldName>: { codecId: <codecId>, nullable: <nullable> } }, return a record of { <fieldName>: <codecOutputType> }
/// Also resolves nullability of the field.
export type ResolveRow<
  Row extends Record<string, ScopeField>,
  CodecTypes extends Record<string, { readonly output: unknown }>,
> = Expand<{
  -readonly [K in keyof Row]: Row[K]['codecId'] extends keyof CodecTypes
    ? Row[K]['nullable'] extends true
      ? CodecTypes[Row[K]['codecId']]['output'] | null
      : CodecTypes[Row[K]['codecId']]['output']
    : unknown;
}>;

type NullableScopeTable<S extends ScopeTable> = {
  [K in keyof S]: { codecId: S[K]['codecId']; nullable: true };
};

type NullableScope<S extends Scope> = {
  topLevel: NullableScopeTable<S['topLevel']>;
  namespaces: {
    [TableName in keyof S['namespaces']]: NullableScopeTable<S['namespaces'][TableName]>;
  };
};

export interface LateralBuilder<CodecTypes extends CodecTypesBase, ParentScope extends Scope> {
  from<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
  ): SelectQuery<CodecTypes, MergeScopes<ParentScope, Other[typeof JoinOuterScope]>, EmptyRow>;
}

export interface JoinCapable<CodecTypes extends CodecTypesBase, AvailableScope extends Scope> {
  innerJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, CodecTypes>,
  ): JoinedTables<CodecTypes, MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>>;

  outerLeftJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, CodecTypes>,
  ): JoinedTables<
    CodecTypes,
    MergeScopes<AvailableScope, NullableScope<Other[typeof JoinOuterScope]>>
  >;

  outerRightJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, CodecTypes>,
  ): JoinedTables<
    CodecTypes,
    MergeScopes<NullableScope<AvailableScope>, Other[typeof JoinOuterScope]>
  >;

  outerFullJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, CodecTypes>,
  ): JoinedTables<
    CodecTypes,
    MergeScopes<NullableScope<AvailableScope>, NullableScope<Other[typeof JoinOuterScope]>>
  >;

  lateralJoin<Alias extends string, LateralRow extends Record<string, ScopeField>>(
    alias: Alias,
    builder: (
      lateral: LateralBuilder<CodecTypes, AvailableScope>,
    ) => SelectQuery<CodecTypes, Scope, LateralRow>,
  ): JoinedTables<
    CodecTypes,
    MergeScopes<AvailableScope, { topLevel: LateralRow; namespaces: Record<Alias, LateralRow> }>
  >;

  outerLateralJoin<Alias extends string, LateralRow extends Record<string, ScopeField>>(
    alias: Alias,
    builder: (
      lateral: LateralBuilder<CodecTypes, AvailableScope>,
    ) => SelectQuery<CodecTypes, Scope, LateralRow>,
  ): JoinedTables<
    CodecTypes,
    MergeScopes<
      AvailableScope,
      NullableScope<{ topLevel: LateralRow; namespaces: Record<Alias, LateralRow> }>
    >
  >;
}

export interface SelectCapable<
  CodecTypes extends CodecTypesBase,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField> = EmptyRow,
> {
  select<Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
    ...columns: Columns
  ): SelectQuery<
    CodecTypes,
    AvailableScope,
    WithFields<RowType, AvailableScope['topLevel'], Columns>
  >;

  select<Alias extends string, Field extends ScopeField>(
    alias: Alias,
    expr: (fields: FieldProxy<AvailableScope>, fns: Functions<CodecTypes>) => Expression<Field>,
  ): SelectQuery<CodecTypes, AvailableScope, WithField<RowType, Field, Alias>>;

  select<Result extends Record<string, Expression<ScopeField>>>(
    callback: (fields: FieldProxy<AvailableScope>, fns: Functions<CodecTypes>) => Result,
  ): SelectQuery<CodecTypes, AvailableScope, Expand<RowType & ExtractScopeFields<Result>>>;
}

export interface JoinedTables<CodecTypes extends CodecTypesBase, AvailableScope extends Scope>
  extends JoinCapable<CodecTypes, AvailableScope>,
    SelectCapable<CodecTypes, AvailableScope> {}

export interface TableProxy<
  CodecTypes extends CodecTypesBase,
  Name extends string,
  Table extends StorageTable,
  Alias extends string = Name,
  AvailableScope extends Scope = DefaultScope<Name, Table>,
> extends JoinSource<StorageTableToScopeTable<Table>, Alias>,
    JoinCapable<CodecTypes, AvailableScope>,
    SelectCapable<CodecTypes, AvailableScope> {
  as<Alias extends string>(
    newAlias: Alias,
  ): TableProxy<CodecTypes, Name, Table, Alias, AvailableScope>;
}

export interface SelectQuery<
  CodecTypes extends CodecTypesBase,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> extends SelectCapable<CodecTypes, AvailableScope, RowType> {
  where(
    expr: ExpressionBuilder<AvailableScope, CodecTypes>,
  ): SelectQuery<CodecTypes, AvailableScope, RowType>;

  limit(count: number): SelectQuery<CodecTypes, AvailableScope, RowType>;

  offset(count: number): SelectQuery<CodecTypes, AvailableScope, RowType>;

  orderBy(
    field: (keyof RowType | keyof AvailableScope['topLevel']) & string,
    options?: OrderByOptions,
  ): SelectQuery<CodecTypes, AvailableScope, RowType>;

  orderBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<CodecTypes>,
    ) => Expression<ScopeField>,
    options?: OrderByOptions,
  ): SelectQuery<CodecTypes, AvailableScope, RowType>;

  as<Alias extends string>(newAlias: Alias): JoinSource<RowType, Alias>;

  first(): Promise<ResolveRow<RowType, CodecTypes>>;
}
