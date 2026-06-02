import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type { MarkerReadResult, MarkerStatement } from '@prisma-next/sql-relational-core/ast';
import { type } from 'arktype';

const MetaSchema = type({ '[string]': 'unknown' });

function parseMeta(meta: unknown): Record<string, unknown> {
  if (meta === null || meta === undefined) {
    return {};
  }

  let parsed: unknown;
  if (typeof meta === 'string') {
    try {
      parsed = JSON.parse(meta);
    } catch {
      return {};
    }
  } else {
    parsed = meta;
  }

  const result = MetaSchema(parsed);
  if (result instanceof type.errors) {
    return {};
  }

  return result as Record<string, unknown>;
}

/**
 * SQLite stores `contract_json` as TEXT, so the wire shape is a JSON string;
 * Postgres uses `jsonb` and returns an already-parsed value. Normalize both
 * here so `ContractMarkerRecord.contractJson` is always the structured form.
 */
function parseContractJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Wire shape of a `prisma_contract.marker` row as it comes out of a SQL
 * driver. Snake-cased to match the on-disk column names. Shared by every
 * SQL target's `readMarker` so each runner doesn't redeclare it inline.
 */
export type ContractMarkerRow = {
  core_hash: string;
  profile_hash: string;
  contract_json: unknown | null;
  canonical_version: number | null;
  updated_at: Date | string;
  app_tag: string | null;
  meta: unknown | null;
  // SQLite stores arrays as JSON-TEXT, so this is `string` on the wire from
  // a SQLite driver and `string[]` from a Postgres driver. Targets normalize
  // before passing to `parseContractMarkerRow`.
  invariants: unknown;
};

const ContractMarkerRowSchema = type({
  core_hash: 'string',
  profile_hash: 'string',
  'contract_json?': 'unknown | null',
  'canonical_version?': 'number | null',
  'updated_at?': 'Date | string',
  'app_tag?': 'string | null',
  'meta?': 'unknown | null',
  invariants: type('string').array(),
});

/**
 * Parses a contract marker row from database query result.
 * This is SQL-specific parsing logic (handles SQL row structure with snake_case columns).
 */
export function parseContractMarkerRow(row: unknown): ContractMarkerRecord {
  const result = ContractMarkerRowSchema(row);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Invalid contract marker row: ${messages}`);
  }

  const updatedAt = result.updated_at
    ? result.updated_at instanceof Date
      ? result.updated_at
      : new Date(result.updated_at)
    : new Date();

  return {
    storageHash: result.core_hash,
    profileHash: result.profile_hash,
    contractJson: parseContractJson(result.contract_json),
    canonicalVersion: result.canonical_version ?? null,
    updatedAt,
    appTag: result.app_tag ?? null,
    meta: parseMeta(result.meta),
    invariants: result.invariants,
  };
}

/**
 * Minimal queryable surface the marker read needs: just `query`. Both the
 * runtime `SqlQueryable` and the control `ControlDriverInstance` satisfy it,
 * so one read flow serves the runtime reader and the control adapter alike.
 */
export interface MarkerReadQueryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: ReadonlyArray<Row> }>;
}

/**
 * Per-dialect inputs to the canonical marker read: the existence probe, the
 * single-row select, and an optional row decode. SQLite stores `invariants`
 * as JSON-encoded TEXT and must decode it to `string[]` before the parser;
 * Postgres' driver hydrates the native array, so no decode is supplied.
 */
export interface MarkerReadShape {
  readonly tableProbe: MarkerStatement;
  readonly selectRow: MarkerStatement;
  readonly decodeRow?: (row: unknown) => unknown;
}

/**
 * Canonical contract-marker read shared by every SQL target. Probes for the
 * marker storage (absent → `no-table`), reads the single row for the space
 * (missing → `absent`), then decodes and parses it (→ `present`). The runtime
 * reader returns this `MarkerReadResult` verbatim; the control adapter
 * projects it to `ContractMarkerRecord | null`.
 */
export async function readMarkerResult(
  queryable: MarkerReadQueryable,
  shape: MarkerReadShape,
): Promise<MarkerReadResult> {
  const exists = await queryable.query(shape.tableProbe.sql, shape.tableProbe.params);
  if (exists.rows.length === 0) {
    return { kind: 'no-table' };
  }

  const result = await queryable.query(shape.selectRow.sql, shape.selectRow.params);
  const row = result.rows[0];
  if (!row) {
    return { kind: 'absent' };
  }

  const decoded = shape.decodeRow ? shape.decodeRow(row) : row;
  return { kind: 'present', record: parseContractMarkerRow(decoded) };
}

/**
 * Collects supported codec type IDs from adapter and extension manifests.
 * Returns a sorted, unique array of type IDs that are declared in the manifests.
 * This enables coverage checks by comparing contract column types against supported types.
 *
 * Note: This extracts type IDs from manifest type imports, not from runtime codec registries.
 * The manifests declare which codec types are available, but the actual type IDs
 * are defined in the codec-types TypeScript modules that are imported.
 *
 * For MVP, we return an empty array since extracting type IDs from TypeScript modules
 * would require runtime evaluation or static analysis. This can be enhanced later.
 */
export function collectSupportedCodecTypeIds(
  descriptors: ReadonlyArray<{ readonly id: string }>,
): readonly string[] {
  // For MVP, return empty array
  // Future enhancement: Extract type IDs from codec-types modules via static analysis
  // or require manifests to explicitly list supported type IDs
  void descriptors;
  return [];
}
