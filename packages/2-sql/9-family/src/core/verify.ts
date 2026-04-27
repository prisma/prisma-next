import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type { ControlDriverInstance } from '@prisma-next/framework-components/control';
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

const ContractMarkerRowSchema = type({
  core_hash: 'string',
  profile_hash: 'string',
  'contract_json?': 'unknown | null',
  'canonical_version?': 'number | null',
  'updated_at?': 'Date | string',
  'app_tag?': 'string | null',
  'meta?': 'unknown | null',
  'invariants?': type('string').array().or('null'),
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
    contractJson: result.contract_json ?? null,
    canonicalVersion: result.canonical_version ?? null,
    updatedAt,
    appTag: result.app_tag ?? null,
    meta: parseMeta(result.meta),
    invariants: result.invariants ?? [],
  };
}

/**
 * Returns the SQL statement to read the contract marker.
 * This is a migration-plane helper (no runtime imports).
 * @internal - Used internally by readMarker(). Prefer readMarker() for Control Plane usage.
 */
export function readMarkerSql(): { readonly sql: string; readonly params: readonly unknown[] } {
  return {
    sql: `select
      core_hash,
      profile_hash,
      contract_json,
      canonical_version,
      updated_at,
      app_tag,
      meta,
      invariants
    from prisma_contract.marker
    where id = $1`,
    params: [1],
  };
}

/**
 * Returns the SQL statement that probes for the existence of the marker table.
 * Uses the SQL-standard `information_schema.tables` view so the query succeeds
 * (returning zero rows) when the table has not been created yet — avoiding a
 * `relation does not exist` error. Some Postgres wire-protocol implementations
 * (e.g. PGlite's TCP proxy) do not fully recover from an extended-protocol
 * parse error, so we probe first instead of relying on an error signal.
 * @internal - Used internally by readMarker().
 */
export function markerTableExistsSql(): {
  readonly sql: string;
  readonly params: readonly unknown[];
} {
  return {
    sql: `select 1
    from information_schema.tables
    where table_schema = $1 and table_name = $2`,
    params: ['prisma_contract', 'marker'],
  };
}

/**
 * Reads the contract marker from the database using the provided driver.
 * Returns the parsed marker record or null if no marker is found.
 * This abstracts SQL-specific details from the Control Plane.
 *
 * @param driver - ControlDriverInstance instance for executing queries
 * @returns Promise resolving to ContractMarkerRecord or null if marker not found
 */
export async function readMarker(
  driver: ControlDriverInstance<'sql', string>,
): Promise<ContractMarkerRecord | null> {
  // Probe for the marker table first so that a fresh database (no
  // `prisma_contract` schema) returns null cleanly instead of surfacing a
  // `relation does not exist` error. This keeps the control connection in a
  // predictable state for driver implementations that are sensitive to
  // extended-protocol parse errors.
  const existsStatement = markerTableExistsSql();
  const existsResult = await driver.query(existsStatement.sql, existsStatement.params);
  if (existsResult.rows.length === 0) {
    return null;
  }

  const markerStatement = readMarkerSql();
  const queryResult = await driver.query<{
    core_hash: string;
    profile_hash: string;
    contract_json: unknown | null;
    canonical_version: number | null;
    updated_at: Date | string;
    app_tag: string | null;
    meta: unknown | null;
    invariants: readonly string[] | null;
  }>(markerStatement.sql, markerStatement.params);

  if (queryResult.rows.length === 0) {
    return null;
  }

  const markerRow = queryResult.rows[0];
  if (!markerRow) {
    throw new Error('Database query returned unexpected result structure');
  }

  return parseContractMarkerRow(markerRow);
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
