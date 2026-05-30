import type { StorageTable } from '@prisma-next/sql-contract/types';
import type { TableProxy } from './table-proxy';

export type CapabilitiesBase = Record<string, Record<string, boolean>>;

// Reserved sibling keys under the flat `storage` plane (ADR 221): they sit
// alongside the namespace-id keys but are not namespaces, so the
// table-name walk below excludes them.
type StorageNamespaceKey<S> = Exclude<keyof S, 'storageHash' | 'types'>;

// The sql-builder DSL is flat by table name across every declared
// namespace. Two namespaces declaring tables with the same name produce
// a union at the DSL surface (which collapses to a type error at the
// first call site); landing the namespace-aware DSL surface (db.<ns>.<table>)
// is tracked separately. Within scope here: the DSL accepts the
// flat storage shape directly and walks every namespace.
//
// The constraint only requires the reserved `storageHash` key to be
// present; namespace-id keys are read structurally per concrete contract
// (the `SqlStorage` class type exposes them, as does the emitted
// `contract.d.ts`). Intersecting a `Record<string, …namespace…>` here
// would force `storageHash` itself to be a namespace entry, which the
// reserved-key storage shape cannot satisfy.
export type TableProxyContract = {
  readonly storage: {
    readonly storageHash: string;
  };
  readonly capabilities: CapabilitiesBase;
};

// Union of every table name declared in any namespace of `C`. Replaces
// the prior `UnboundTables<C>` indexing (which only saw `__unbound__`).
export type UnboundTables<C extends TableProxyContract> = {
  readonly [Name in TableNamesAcrossNamespaces<C>]: TableInAnyNamespace<C, Name>;
};

// Each non-reserved key holds a namespace entry whose `tables` map we walk.
// `.tables` is pulled out with a constrained `infer` (rather than indexed
// directly) for two reasons: the reserved `storageHash` sibling — which the
// constraint permits but which is not a namespace — never has `['tables']`
// indexed into it, and `infer Tables extends Record<string, StorageTable>`
// re-establishes the `StorageTable` upper bound that the prior
// `namespaces`-keyed constraint supplied, so downstream `Scope`/`ScopeTable`
// derivations still see a `StorageTable`.
type TableNamesAcrossNamespaces<C extends TableProxyContract> = {
  [NSId in StorageNamespaceKey<C['storage']>]: C['storage'][NSId] extends {
    readonly tables: infer Tables extends Record<string, StorageTable>;
  }
    ? keyof Tables & string
    : never;
}[StorageNamespaceKey<C['storage']>];

type TableInAnyNamespace<C extends TableProxyContract, Name extends string> = {
  [NSId in StorageNamespaceKey<C['storage']>]: C['storage'][NSId] extends {
    readonly tables: infer Tables extends Record<string, StorageTable>;
  }
    ? Name extends keyof Tables
      ? Tables[Name]
      : never
    : never;
}[StorageNamespaceKey<C['storage']>];

export type Db<C extends TableProxyContract> = {
  [Name in TableNamesAcrossNamespaces<C>]: TableProxy<C, Name>;
};
