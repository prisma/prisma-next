import type { StorageTable } from '@prisma-next/sql-contract/types';
import type { TableProxy } from './table-proxy';

export type CapabilitiesBase = Record<string, Record<string, boolean>>;

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
  readonly [Name in keyof C['storage']['namespaces'][NsId]['entries']['table'] &
    string]: TableProxy<C, Name>;
};

export type Db<C extends TableProxyContract> = {
  readonly [Ns in keyof C['storage']['namespaces']]: Namespace<C, Ns>;
};
