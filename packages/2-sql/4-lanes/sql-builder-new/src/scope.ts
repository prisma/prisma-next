import type { StorageTable } from '@prisma-next/sql-contract/types';

export type CapabilityGated<Capabilities, Required, TrueBranch> = Capabilities extends Required
  ? TrueBranch
  : Record<string, never>;

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;
export declare const ExpressionType: unique symbol;
export declare const JoinOuterScope: unique symbol;
export declare const SubqueryMarker: unique symbol;

export type Expand<T> = { [K in keyof T]: T[K] } & unknown;
export type EmptyRow = Record<never, ScopeField>;

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

export type MergeScopes<A extends Scope, B extends Scope> = {
  topLevel: Expand<
    Omit<A['topLevel'], keyof B['topLevel']> & Omit<B['topLevel'], keyof A['topLevel']>
  >;
  namespaces: Expand<A['namespaces'] & B['namespaces']>;
};

export type RebindScope<S extends Scope, OldKey extends string, NewKey extends string> = {
  topLevel: S['topLevel'];
  namespaces: Expand<Omit<S['namespaces'], OldKey> & Record<NewKey, S['namespaces'][OldKey]>>;
};

export type NullableScopeTable<S extends ScopeTable> = {
  [K in keyof S]: { codecId: S[K]['codecId']; nullable: true };
};

export type NullableScope<S extends Scope> = {
  topLevel: NullableScopeTable<S['topLevel']>;
  namespaces: {
    [TableName in keyof S['namespaces']]: NullableScopeTable<S['namespaces'][TableName]>;
  };
};

export type Subquery<RowType extends Record<string, ScopeField>> = {
  [SubqueryMarker]: RowType;
};

export type OperationTypesBase = Record<
  string,
  {
    readonly args: readonly ScopeField[];
    readonly returns: ScopeField;
  }
>;

export type QueryContext = {
  readonly codecTypes: CodecTypesBase;
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly queryOperationTypes: OperationTypesBase;
};

export type { CodecTypesBase, StorageTable };
