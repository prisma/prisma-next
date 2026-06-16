// Shared lane-side helpers for indexing the emitted `StorageColumnTypes` /
// `StorageColumnInputTypes` maps. Both sql-builder (knows the namespace
// coordinate) and the query-builder lane (flat-table view across namespaces)
// reach the same `[ns][table][column]` slot; this module owns the indexing.

// The column-type slice for a single namespace/table. `never` when the map is
// the empty default (a non-emitted `defineContract` contract carries
// `Record<string, never>`, whose `keyof` is `string`) or when the coordinate is
// absent from an emitted map.
export type StorageColumnMapAt<
  SCT,
  NsId extends string,
  TableName extends string,
> = string extends keyof SCT
  ? never
  : NsId extends keyof SCT
    ? string extends keyof SCT[NsId]
      ? never
      : TableName extends keyof SCT[NsId]
        ? SCT[NsId][TableName]
        : never
    : never;

// Cross-namespace lookup for the flat-table view: the column type at any
// namespace that declares the table; collisions union.
export type StorageColumnTypeAcrossNamespaces<
  SCT,
  TableName extends string,
  ColumnName extends string,
> = {
  [Ns in keyof SCT]: TableName extends keyof SCT[Ns]
    ? ColumnName extends keyof SCT[Ns][TableName]
      ? SCT[Ns][TableName][ColumnName]
      : never
    : never;
}[keyof SCT];
