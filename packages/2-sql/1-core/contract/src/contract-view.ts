import type { Contract } from '@prisma-next/contract/types';
import {
  buildSingleNamespaceView,
  type DefaultNamespaceEntries,
  promoteBuiltinKinds,
  type SingleNamespaceView,
} from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
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

/**
 * Single-namespace SQL view shape: `cv.table.<name>` and `cv.valueSet.<name>`
 * top-level, pack kinds under `cv.entries.<kind>`. A target that never emits a
 * given built-in kind (SQLite has `sql.enums: false`, so it emits no
 * `valueSet`) resolves that slot to an empty map.
 */
export type SqlSingleNamespaceViewShape<TContract extends Contract<SqlStorage>> =
  SingleNamespaceView<SqlEntries<TContract>, SqlBuiltinKind>;

/**
 * Builds the single-namespace SQL view: unwraps the default namespace and
 * promotes the SQL built-in kinds (`table`, `valueSet`). Targets with one
 * default namespace (SQLite) call this directly; Postgres qualifies by schema
 * and does not use it.
 */
export function buildSqlSingleNamespaceView<TContract extends Contract<SqlStorage>>(
  contract: TContract,
): SqlSingleNamespaceViewShape<TContract> {
  return buildSingleNamespaceView<SqlSingleNamespaceViewShape<TContract>>(
    contract.storage,
    SQL_BUILTIN_KINDS,
  );
}

/**
 * Schema-qualified SQL view shape: each storage namespace key (`public`,
 * `auth`, the default `__unbound__`, …) maps to its own single-namespace view,
 * mirroring the facade's `sql.<ns>.<table>` keying exactly — including the
 * literal `__unbound__` key for the default schema (the facade does not rename
 * it). Within each schema, `cv.<ns>.table.<name>` / `cv.<ns>.valueSet.<name>`
 * are top-level and pack kinds sit under `cv.<ns>.entries.<kind>`.
 */
export type SqlSchemaQualifiedViewShape<TContract extends Contract<SqlStorage>> = {
  readonly [Ns in keyof TContract['storage']['namespaces']]: TContract['storage']['namespaces'][Ns] extends {
    readonly entries: infer E;
  }
    ? SingleNamespaceView<E, SqlBuiltinKind>
    : never;
};

/**
 * Builds the schema-qualified SQL view: one single-namespace projection per
 * storage namespace, keyed by the raw namespace id (no renaming of the default
 * schema). Postgres uses this; SQLite (single default namespace) uses
 * {@link buildSqlSingleNamespaceView}.
 */
export function buildSqlSchemaQualifiedView<TContract extends Contract<SqlStorage>>(
  contract: TContract,
): SqlSchemaQualifiedViewShape<TContract> {
  const out: Record<string, unknown> = {};
  for (const [nsId, ns] of Object.entries(contract.storage.namespaces)) {
    out[nsId] = promoteBuiltinKinds(
      blindCast<
        Readonly<Record<string, unknown>>,
        'Namespace.entries is the open ADR 224 dictionary Record<string, Record<string, unknown>>'
      >(ns.entries),
      SQL_BUILTIN_KINDS,
    );
  }
  return blindCast<
    SqlSchemaQualifiedViewShape<TContract>,
    'each namespace projected to its SingleNamespaceView; keys mirror the storage namespace ids'
  >(out);
}
