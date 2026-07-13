export type BackingIndexCandidates = {
  readonly indexes: readonly { readonly columns: readonly string[] }[];
  readonly uniques: readonly { readonly columns: readonly string[] }[];
  readonly primaryKey?: { readonly columns: readonly string[] } | undefined;
};

/**
 * The column-list keys (`"colA,colB"`, order preserved) a table's own
 * indexes, unique constraints, and primary key already back. A foreign key
 * whose source columns join to one of these keys needs no separately
 * derived backing index.
 *
 * Shared by {@link isBackedByColumnKeys}'s two callers, which must agree on
 * what counts as "backed": `contract-to-schema-ir.ts`'s `convertTable`
 * (deriving the FK-backing-index expectation `db verify` checks against a
 * live database) and the postgres PSL inferrer (deciding whether an
 * introspected relation needs an explicit `index: false`).
 */
export function backingIndexColumnKeys(table: BackingIndexCandidates): readonly string[] {
  return [
    ...table.indexes.map((index) => index.columns.join(',')),
    ...table.uniques.map((unique) => unique.columns.join(',')),
    ...(table.primaryKey ? [table.primaryKey.columns.join(',')] : []),
  ];
}

/**
 * Whether `columns`, in order, matches one of `backingKeys` (see
 * {@link backingIndexColumnKeys}). Order-sensitive: `(a, b)` does not
 * satisfy a backing index declared as `(b, a)`.
 */
export function isBackedByColumnKeys(
  columns: readonly string[],
  backingKeys: readonly string[],
): boolean {
  return backingKeys.includes(columns.join(','));
}
