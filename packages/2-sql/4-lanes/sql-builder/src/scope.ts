import type { QueryOperationTypesBase, StorageTable } from '@prisma-next/sql-contract/types';
import type { AnyFromSource } from '@prisma-next/sql-relational-core/ast';
import type { CodecTypesBase, ScopeField } from '@prisma-next/sql-relational-core/expression';

export type { ScopeField };
// `Subquery` was moved to `sql-relational-core` to break a workspace cycle
// (`family-sql` needed `Subquery` for its operation type twin without
// depending on `sql-builder`). Re-exported here so existing
// `import { Subquery } from '@prisma-next/sql-builder/types'` callsites
// continue to resolve. `SubqueryMarker` is not re-exported — in-package
// consumers (`runtime/query-impl.ts`) import it directly from
// `@prisma-next/sql-relational-core/expression` because it is a
// `declare`d value symbol and a value re-export would emit a runtime
// binding that the upstream module does not provide.
export type { Subquery } from '@prisma-next/sql-relational-core/expression';

export type TraitField = { traits: readonly string[]; nullable: boolean };
export type FieldSpec = ScopeField | TraitField;

export type GatedMethod<Capabilities, Required, Method> = Capabilities extends Required
  ? Method
  : never;

export declare const JoinOuterScope: unique symbol;

export type Expand<T> = { [K in keyof T]: T[K] } & unknown;
export type EmptyRow = Record<never, ScopeField>;

export type ScopeTable = Record<string, ScopeField>;

export type Scope = {
  topLevel: ScopeTable;
  namespaces: Record<string, ScopeTable>;
};

export type JoinSource<Row extends ScopeTable, Alias extends string> = {
  readonly [JoinOuterScope]: {
    topLevel: Row;
    namespaces: Record<Alias, Row>;
  };

  getJoinOuterScope(): Scope;
  buildAst(): AnyFromSource;
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

export type QueryContext = {
  readonly codecTypes: CodecTypesBase;
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly queryOperationTypes: QueryOperationTypesBase;
  readonly resolvedColumnOutputTypes: Record<string, unknown>;
};

export type { StorageTable };
