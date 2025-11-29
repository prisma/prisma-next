import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type { ControlDriverInstance } from '@prisma-next/core-control-plane/types';
import {
  ensureSchemaStatement,
  ensureTableStatement,
  readContractMarker,
  writeContractMarker,
} from '@prisma-next/sql-runtime';
import { type } from 'arktype';

/**
 * Parses meta field from database result.
 */
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

  const MetaSchema = type({ '[string]': 'unknown' });
  const result = MetaSchema(parsed);
  if (result instanceof type.errors) {
    return {};
  }

  return result as Record<string, unknown>;
}

/**
 * Parses a contract marker row from database query result.
 */
function parseContractMarkerRow(row: unknown): ContractMarkerRecord {
  const ContractMarkerRowSchema = type({
    core_hash: 'string',
    profile_hash: 'string',
    'contract_json?': 'unknown | null',
    'canonical_version?': 'number | null',
    'updated_at?': 'Date | string',
    'app_tag?': 'string | null',
    'meta?': 'unknown | null',
  });

  const result = ContractMarkerRowSchema(row);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Invalid contract marker row: ${messages}`);
  }

  const validatedRow = result as {
    core_hash: string;
    profile_hash: string;
    contract_json?: unknown | null;
    canonical_version?: number | null;
    updated_at?: Date | string;
    app_tag?: string | null;
    meta?: unknown | null;
  };

  const updatedAt = validatedRow.updated_at
    ? validatedRow.updated_at instanceof Date
      ? validatedRow.updated_at
      : new Date(validatedRow.updated_at)
    : new Date();

  return {
    coreHash: validatedRow.core_hash,
    profileHash: validatedRow.profile_hash,
    contractJson: validatedRow.contract_json ?? null,
    canonicalVersion: validatedRow.canonical_version ?? null,
    updatedAt,
    appTag: validatedRow.app_tag ?? null,
    meta: parseMeta(validatedRow.meta),
  };
}

/**
 * Reads the contract marker from the database.
 */
export async function readMarker(
  driver: ControlDriverInstance<'postgres'>,
): Promise<ContractMarkerRecord | null> {
  const markerStatement = readContractMarker();
  const queryResult = await driver.query<{
    core_hash: string;
    profile_hash: string;
    contract_json: unknown | null;
    canonical_version: number | null;
    updated_at: Date | string;
    app_tag: string | null;
    meta: unknown | null;
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
 * Writes the contract marker to the database.
 */
export async function writeMarker(
  driver: ControlDriverInstance<'postgres'>,
  input: {
    readonly coreHash: string;
    readonly profileHash: string;
    readonly contractJson?: unknown;
    readonly canonicalVersion?: number;
  },
  existingMarker: ContractMarkerRecord | null,
): Promise<void> {
  const writeStatements = writeContractMarker({
    coreHash: input.coreHash,
    profileHash: input.profileHash,
    ...(input.contractJson !== undefined ? { contractJson: input.contractJson } : {}),
    ...(input.canonicalVersion !== undefined ? { canonicalVersion: input.canonicalVersion } : {}),
  });

  // Use INSERT for new marker, UPDATE for existing
  const markerSql =
    existingMarker === null ? writeStatements.insert.sql : writeStatements.update.sql;
  const markerParams =
    existingMarker === null ? writeStatements.insert.params : writeStatements.update.params;

  await driver.query(markerSql, markerParams);
}

/**
 * Ensures the prisma_contract schema exists.
 */
export async function ensureSchema(driver: ControlDriverInstance<'postgres'>): Promise<void> {
  await driver.query(ensureSchemaStatement.sql, ensureSchemaStatement.params);
}

/**
 * Ensures the marker table exists.
 */
export async function ensureMarkerTable(driver: ControlDriverInstance<'postgres'>): Promise<void> {
  await driver.query(ensureTableStatement.sql, ensureTableStatement.params);
}
