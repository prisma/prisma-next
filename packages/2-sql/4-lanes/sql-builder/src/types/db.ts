import type { StorageTable } from '@prisma-next/sql-contract/types';
import type { TableProxy } from './table-proxy';

export type CapabilitiesBase = Record<string, Record<string, boolean>>;

// The sql-builder DSL is flat by table name across every declared
// namespace. Two namespaces declaring tables with the same name produce
// a union at the DSL surface (which collapses to a type error at the
// first call site); landing the namespace-aware DSL surface (db.<ns>.<table>)
// is tracked separately. Within scope here: the DSL accepts the
// namespaced storage shape directly and walks every namespace.
export type TableProxyContract = {
  readonly storage: {
    readonly namespaces: Readonly<
      Record<
        string,
        { readonly entries: { readonly table: Readonly<Record<string, StorageTable>> } }
      >
    >;
  };
  readonly capabilities: CapabilitiesBase;
};

// Union of every table name declared in any namespace of `C`. Replaces
// the prior `UnboundTables<C>` indexing (which only saw `__unbound__`).
export type UnboundTables<C extends TableProxyContract> = {
  readonly [Name in TableNamesAcrossNamespaces<C>]: TableInAnyNamespace<C, Name>;
};

export type TableNamesAcrossNamespaces<C extends TableProxyContract> = {
  [NSId in keyof C['storage']['namespaces']]: keyof C['storage']['namespaces'][NSId]['entries']['table'] &
    string;
}[keyof C['storage']['namespaces']];

export type TableInAnyNamespace<C extends TableProxyContract, Name extends string> = {
  [NSId in keyof C['storage']['namespaces']]: Name extends keyof C['storage']['namespaces'][NSId]['entries']['table']
    ? C['storage']['namespaces'][NSId]['entries']['table'][Name]
    : never;
}[keyof C['storage']['namespaces']];

// The tables of a single storage namespace, keyed by bare table name. Lets
// callers reach a table by its namespace coordinate (`db.<ns>.<table>`) when
// the same bare name is declared in more than one namespace.
export type Namespace<
  C extends TableProxyContract,
  NsId extends keyof C['storage']['namespaces'],
> = {
  readonly [Name in keyof C['storage']['namespaces'][NsId]['tables'] & string]: TableProxy<C, Name>;
};

// Additive intersection: the flat by-bare-name surface retained alongside a
// per-namespace facet keyed by namespace id.
export type Db<C extends TableProxyContract> = {
  readonly [Name in TableNamesAcrossNamespaces<C>]: TableProxy<C, Name>;
} & {
  readonly [Ns in keyof C['storage']['namespaces']]: Namespace<C, Ns>;
};
