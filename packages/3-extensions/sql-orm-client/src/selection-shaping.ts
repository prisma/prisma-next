// Selection-shaping helpers shared between the single-query planner
// (`query-plan-select.ts`) and the multi-query stitcher (`collection-dispatch.ts`).
//
// "Selection shaping" is query-shape augmentation: given a user-visible
// `selectedFields` list and a set of columns the query plan / stitcher
// requires (typically join keys), return the projection list to send to
// SQL alongside the set of "hidden" columns the caller must strip from
// the user-visible row before returning it.
//
// Row-mapping helpers (`stripHiddenMappedFields`, envelope/mapped rows)
// stay in `collection-runtime` because they mutate user-visible rows
// rather than shape the query.

export function augmentSelectionForJoinColumns(
  selectedFields: readonly string[] | undefined,
  requiredColumns: readonly string[],
): {
  selectedForQuery: readonly string[] | undefined;
  hiddenColumns: readonly string[];
} {
  if (!selectedFields) {
    return {
      selectedForQuery: selectedFields,
      hiddenColumns: [],
    };
  }

  const hiddenColumns = requiredColumns.filter((column) => !selectedFields.includes(column));
  if (hiddenColumns.length === 0) {
    return {
      selectedForQuery: selectedFields,
      hiddenColumns: [],
    };
  }

  return {
    selectedForQuery: [...selectedFields, ...hiddenColumns],
    hiddenColumns,
  };
}
