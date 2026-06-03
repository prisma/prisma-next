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
    'select 1 from information_schema.tables where table_schema = $1 and table_name = $2',
    ['prisma_contract', 'marker'],
  );
  if (exists.rows.length === 0) {
    return { kind: 'no-table' };
  }

  const result = await driver.query(
    'select core_hash, profile_hash, contract_json, canonical_version, updated_at, app_tag, meta, invariants from prisma_contract.marker where space = $1',
    [space],
  );
  const row = result.rows[0];
  if (!row) {
    return { kind: 'absent' };
  }

  return { kind: 'present', record: parseContractMarkerRow(row) };
}
