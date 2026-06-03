import { parseContractMarkerRow } from '@prisma-next/family-sql/verify';
import type { MarkerReadResult } from '@prisma-next/sql-relational-core/ast';

type MarkerReadDriver = {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: ReadonlyArray<Row> }>;
};

export async function readMarker(
  driver: MarkerReadDriver,
  space: string,
): Promise<MarkerReadResult> {
  const exists = await driver.query(
    "select 1 from sqlite_master where type = 'table' and name = ?",
    ['_prisma_marker'],
  );
  if (exists.rows.length === 0) {
    return { kind: 'no-table' };
  }

  const result = await driver.query(
    'select core_hash, profile_hash, contract_json, canonical_version, updated_at, app_tag, meta, invariants from _prisma_marker where space = ?',
    [space],
  );
  const row = result.rows[0];
  if (!row) {
    return { kind: 'absent' };
  }

  return { kind: 'present', record: parseContractMarkerRow(decodeSqliteMarkerRow(row)) };
}

export function decodeSqliteMarkerRow(row: unknown): unknown {
  if (typeof row !== 'object' || row === null || !('invariants' in row)) {
    return row;
  }
  const record = row as { invariants: unknown };
  if (typeof record.invariants !== 'string') return row;
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.invariants);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid contract marker row: invariants is not valid JSON: ${detail}`);
  }
  return { ...record, invariants: parsed };
}
