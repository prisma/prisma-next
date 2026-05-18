import type { StorageTable } from '@prisma-next/sql-contract/types';
import type { TableProxy } from './table-proxy';

export type CapabilitiesBase = Record<string, Record<string, boolean>>;

// TODO(TML-2550): replace with namespace-aware Db<C> shape (unbound-at-root +
// qualified db.<namespaceId>.<table> for named namespaces; collision handling
// per the follow-up's design decision). See projects/target-extensible-ir/plan.md
// § M5c "Deferred follow-up" for the full rationale.
//
// Naïve flatten — every PR2 fixture lives in __unbound__ only, so cross-namespace
// name collisions are structurally impossible today. The follow-up MUST design
// collision behaviour before any test fixture introduces a colliding name.
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (
  x: infer I,
) => void
  ? I
  : never;

export type FlatTablesOf<TablesByNamespace> = [TablesByNamespace] extends [
  Readonly<Record<string, infer V>>,
]
  ? [V] extends [StorageTable]
    ? TablesByNamespace
    : [V] extends [Readonly<Record<string, StorageTable>>]
      ? UnionToIntersection<V>
      : Record<string, StorageTable>
  : Record<string, StorageTable>;

export type TableProxyContract = {
  readonly storage: {
    readonly tables: Readonly<Record<string, Readonly<Record<string, StorageTable>>>>;
  };
  readonly capabilities: CapabilitiesBase;
};

export type Db<C extends TableProxyContract> = {
  [Name in string & keyof FlatTablesOf<C['storage']['tables']>]: TableProxy<C, Name>;
};
