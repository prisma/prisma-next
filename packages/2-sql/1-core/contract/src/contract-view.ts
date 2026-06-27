import type { Contract } from '@prisma-next/contract/types';
import {
  buildNamespaceAccessor,
  buildSingleNamespaceView,
  composeContractView,
  type DefaultNamespaceEntries,
  type NamespaceAccessor,
  type PromotedNamespaces,
  type SingleNamespaceView,
} from '@prisma-next/framework-components/ir';
import type { SqlStorage } from './ir/sql-storage';

/**
 * The SQL family's statically-named built-in entity kinds. `table` and
 * `valueSet` are promoted to top-level view accessors; pack-contributed kinds
 * (e.g. `policy`) stay under `.entries`.
 */
export const SQL_BUILTIN_KINDS = ['table', 'valueSet'] as const;
export type SqlBuiltinKind = (typeof SQL_BUILTIN_KINDS)[number];

type SqlEntries<TContract extends Contract<SqlStorage>> = DefaultNamespaceEntries<
  TContract['storage']
>;

type SqlNamespaces<TContract extends Contract<SqlStorage>> = TContract['storage']['namespaces'];

/**
 * The single-namespace SQL accessors: `table`/`valueSet` top-level, pack kinds
 * under `entries`. A target that never emits a built-in kind (SQLite has
 * `sql.enums: false`, so it emits no `valueSet`) resolves that slot to an empty
 * map.
 */
export type SqlSingleNamespaceAccessors<TContract extends Contract<SqlStorage>> =
  SingleNamespaceView<SqlEntries<TContract>, SqlBuiltinKind>;

/**
 * Single-namespace SQL view: the deserialized contract intersected with the
 * by-name accessors, so the value is substitutable for `Contract` while also
 * exposing:
 *  - `view.table.<name>` / `view.valueSet.<name>` — built-in kinds, default
 *    namespace unwrapped; pack kinds under `view.entries.<kind>`.
 *  - `view.namespace.<id>` — every namespace by raw id (SQLite's sole namespace
 *    is `__unbound__`).
 */
export type SqlSingleNamespaceView<TContract extends Contract<SqlStorage>> = TContract &
  SqlSingleNamespaceAccessors<TContract> & {
    readonly namespace: NamespaceAccessor<SqlNamespaces<TContract>, SqlBuiltinKind>;
  };

/**
 * Builds the single-namespace SQL view: promotes the SQL built-in-kind accessors
 * (`table`, `valueSet`) at the root, attaches the `namespace` accessor, and
 * layers everything over the deserialized contract. Targets with one default
 * namespace (SQLite) call this directly; Postgres qualifies by schema.
 */
export function buildSqlSingleNamespaceView<TContract extends Contract<SqlStorage>>(
  contract: TContract,
): SqlSingleNamespaceView<TContract> {
  const rootAccessors = buildSingleNamespaceView<SqlSingleNamespaceAccessors<TContract>>(
    contract.storage,
    SQL_BUILTIN_KINDS,
  );
  const namespaceAccessor = buildNamespaceAccessor<
    NamespaceAccessor<SqlNamespaces<TContract>, SqlBuiltinKind>
  >(contract.storage, SQL_BUILTIN_KINDS);
  return composeContractView<SqlSingleNamespaceView<TContract>>(
    contract,
    rootAccessors,
    namespaceAccessor,
  );
}

/**
 * Schema-qualified SQL view: the deserialized contract intersected with
 *  - `view.namespace.<id>` — every schema by raw id (the fully-qualified,
 *    collision-proof accessor; `view.namespace.storage` is the schema literally
 *    named `storage`), and
 *  - root-promoted schema names — each schema promoted to a top-level accessor
 *    EXCEPT names that collide with a contract envelope field or the reserved
 *    `namespace` key, which are reachable only via `view.namespace.<id>`.
 *
 * So `view.public.table.users` works at the root, and `view.storage` always
 * remains the contract's `storage` field (never a schema named `storage`).
 * Mirrors the facade's `sql.<ns>` keying (the default schema keeps its literal
 * `__unbound__` id).
 */
export type SqlSchemaQualifiedView<TContract extends Contract<SqlStorage>> = TContract & {
  readonly namespace: NamespaceAccessor<SqlNamespaces<TContract>, SqlBuiltinKind>;
} & PromotedNamespaces<TContract, SqlNamespaces<TContract>, SqlBuiltinKind>;

/**
 * Builds the schema-qualified SQL view: the `namespace` accessor holds every
 * schema by raw id; non-colliding schema names are promoted to the root.
 * Postgres uses this; SQLite (single default namespace) uses
 * {@link buildSqlSingleNamespaceView}.
 */
export function buildSqlSchemaQualifiedView<TContract extends Contract<SqlStorage>>(
  contract: TContract,
): SqlSchemaQualifiedView<TContract> {
  const namespaceAccessor = buildNamespaceAccessor<
    NamespaceAccessor<SqlNamespaces<TContract>, SqlBuiltinKind>
  >(contract.storage, SQL_BUILTIN_KINDS);
  return composeContractView<SqlSchemaQualifiedView<TContract>>(contract, {}, namespaceAccessor);
}
