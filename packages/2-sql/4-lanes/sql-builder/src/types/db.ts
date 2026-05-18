import type { StorageTable } from '@prisma-next/sql-contract/types';
import type { TableProxy } from './table-proxy';

export type CapabilitiesBase = Record<string, Record<string, boolean>>;

// The sql-builder DSL surfaces tables from the `__unbound__` namespace at
// the root of the `db` proxy. Tables in named namespaces are not yet
// addressable through the flat DSL — that's deferred to the namespace-aware
// DSL redesign. Within scope here: the DSL accepts the namespaced storage
// shape directly with no transitional bridge type.
export type TableProxyContract = {
  readonly storage: {
    readonly namespaces: {
      readonly __unbound__: { readonly tables: Record<string, StorageTable> };
    };
  };
  readonly capabilities: CapabilitiesBase;
};

export type UnboundTables<C extends TableProxyContract> =
  C['storage']['namespaces']['__unbound__']['tables'];

export type Db<C extends TableProxyContract> = {
  [Name in string & keyof UnboundTables<C>]: TableProxy<C, Name>;
};
