import { blindCast } from '@prisma-next/utils/casts';

/**
 * Recombine PPG's positional `Row.values` with the resultset's `columns`
 * into a name-keyed record (the row shape the framework expects).
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
