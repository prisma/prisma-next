import type { StorageTable } from '@prisma-next/sql-contract/types';
import type { DefaultScope } from '../scope';
import type { ContractToQC, TableProxy } from './table-proxy';

export type CapabilitiesBase = Record<string, Record<string, boolean>>;

export type TableProxyContract = {
  readonly storage: { readonly tables: Record<string, StorageTable> };
  readonly capabilities: CapabilitiesBase;
};

/**
 * `Db<C, Registry>` is the typed `db.sql` surface produced by `sql({...})`.
 *
 * The `Registry` generic carries the merged shape of every annotation
 * handle contributed by the runtime's middleware. Lane terminals'
 * `.annotate(callback)` method receives a kind-filtered
 * `AnnotationBuilder<K, Registry>` derived from this generic, so the
 * structural property filter (`meta.cache`, `meta.audit`, …) only
 * surfaces handles that are runtime-known and applicable to the
 * terminal's operation kind.
 *
 * Defaults to `{}` for callers who don't pass a registry-bearing factory
 * (e.g. directly constructing `sql({ context })` without
 * `annotationRegistry`); the resulting `meta` builder will have no
 * methods, leaving only the array escape hatch `meta => [...]`.
 */
export type Db<C extends TableProxyContract, Registry = {}> = {
  [Name in string & keyof C['storage']['tables']]: TableProxy<
    C,
    Name,
    Name,
    DefaultScope<Name, C['storage']['tables'][Name]>,
    ContractToQC<C, Name>,
    Registry
  >;
};
