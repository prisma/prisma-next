import { blindCast } from '@prisma-next/utils/casts';

/**
 * Recombine a positionally-indexed PPG `Row` and the resultset's `columns`
 * descriptor into a name-keyed record matching the framework's
 * `SqlQueryResult<Row>` row shape.
 *
 * PPG returns rows as `{ values: unknown[] }` where `values[i]` aligns with
 * `columns[i].name`. The framework expects rows keyed by column name. This
 * helper performs the shape transform; it does not attempt to narrow the
 * column-value types.
 */
export function mapRowToRecord<Row = Record<string, unknown>>(
  ppgRow: { readonly values: readonly unknown[] },
  columns: ReadonlyArray<{ readonly name: string }>,
): Row {
  const record: Record<string, unknown> = {};
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i];
    if (column === undefined) {
      continue;
    }
    record[column.name] = ppgRow.values[i];
  }
  return blindCast<
    Row,
    'shape-only reassembly from positional ppg Row.values into name-keyed Record<string, unknown>; values stay unknown at runtime, only the record-vs-array dimension changes, and the caller-supplied Row parameter is by convention the row schema they expect this query to return'
  >(record);
}
