import type { StorageTable } from '@prisma-next/sql-contract/types';
import type { TableProxy } from './table-proxy';

export type CapabilitiesBase = Record<string, Record<string, boolean>>;

type StorageNamespaceEntry = { readonly tables: Readonly<Record<string, StorageTable>> };

type StorageNamespaceKey<S> = Exclude<keyof S, 'storageHash' | 'types'>;

// The sql-builder DSL is flat by table name across every declared
// namespace. Two namespaces declaring tables with the same name produce
// a union at the DSL surface (which collapses to a type error at the
// first call site); landing the namespace-aware DSL surface (db.<ns>.<table>)
// is tracked separately. Within scope here: the DSL accepts the
// flat storage shape directly and walks every namespace.
export type TableProxyContract = {
  readonly storage: {
    readonly storageHash: string;
  } & Readonly<Record<string, StorageNamespaceEntry>>;
  readonly capabilities: CapabilitiesBase;
};

// Union of every table name declared in any namespace of `C`. Replaces
// the prior `UnboundTables<C>` indexing (which only saw `__unbound__`).
export type UnboundTables<C extends TableProxyContract> = {
  readonly [Name in TableNamesAcrossNamespaces<C>]: TableInAnyNamespace<C, Name>;
};

type TableNamesAcrossNamespaces<C extends TableProxyContract> = {
  [NSId in StorageNamespaceKey<C['storage']>]: keyof C['storage'][NSId]['tables'] & string;
}[StorageNamespaceKey<C['storage']>];

type TableInAnyNamespace<C extends TableProxyContract, Name extends string> = {
  [NSId in StorageNamespaceKey<C['storage']>]: Name extends keyof C['storage'][NSId]['tables']
    ? C['storage'][NSId]['tables'][Name]
    : never;
}[StorageNamespaceKey<C['storage']>];

export type Db<C extends TableProxyContract> = {
  [Name in TableNamesAcrossNamespaces<C>]: TableProxy<C, Name>;
};
