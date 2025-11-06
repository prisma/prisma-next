import { type } from 'arktype';

export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export interface WriteMarkerInput {
  readonly coreHash: string;
  readonly profileHash: string;
  readonly contractJson?: unknown;
  readonly canonicalVersion?: number;
  readonly appTag?: string;
  readonly meta?: Record<string, unknown>;
}

export interface ContractMarkerRecord {
  readonly coreHash: string;
  readonly profileHash: string;
  readonly contractJson: unknown | null;
  readonly canonicalVersion: number | null;
  readonly updatedAt: Date;
  readonly appTag: string | null;
  readonly meta: Record<string, unknown>;
}

export interface ContractMarkerRow {
  core_hash: string;
  profile_hash: string;
  contract_json: unknown | null;
  canonical_version: number | null;
  updated_at: Date;
  app_tag: string | null;
  meta: unknown | null;
}

export const ensureSchemaStatement: SqlStatement = {
  sql: 'create schema if not exists prisma_contract',
  params: [],
};

export const ensureTableStatement: SqlStatement = {
  sql: `create table if not exists prisma_contract.marker (
    id smallint primary key default 1,
    core_hash text not null,
    profile_hash text not null,
    contract_json jsonb,
    canonical_version int,
    updated_at timestamptz not null default now(),
    app_tag text,
    meta jsonb not null default '{}'
  )`,
  params: [],
};

export function readContractMarker(): SqlStatement {
  return {
    sql: `select
      core_hash,
      profile_hash,
      contract_json,
      canonical_version,
      updated_at,
      app_tag,
      meta
    from prisma_contract.marker
    where id = $1`,
    params: [1],
  };
}

export interface WriteContractMarkerStatements {
  readonly insert: SqlStatement;
  readonly update: SqlStatement;
}

export function writeContractMarker(input: WriteMarkerInput): WriteContractMarkerStatements {
  const baseParams: readonly unknown[] = [
    1,
    input.coreHash,
    input.profileHash,
    input.contractJson ?? null,
    input.canonicalVersion ?? null,
    input.appTag ?? null,
    JSON.stringify(input.meta ?? {}),
  ];

  const insert: SqlStatement = {
    sql: `insert into prisma_contract.marker (
        id,
        core_hash,
        profile_hash,
        contract_json,
        canonical_version,
        updated_at,
        app_tag,
        meta
      ) values (
        $1,
        $2,
        $3,
        $4::jsonb,
        $5,
        now(),
        $6,
        $7::jsonb
      )`,
    params: baseParams,
  };

  const update: SqlStatement = {
    sql: `update prisma_contract.marker set
        core_hash = $2,
        profile_hash = $3,
        contract_json = $4::jsonb,
        canonical_version = $5,
        updated_at = now(),
        app_tag = $6,
        meta = $7::jsonb
      where id = $1`,
    params: baseParams,
  };

  return { insert, update };
}

/**
 * Schema for validating the meta field as a Record<string, unknown>.
 */
const MetaSchema = type({ '[string]': 'unknown' });

/**
 * Parses and validates the meta field from a database row.
 * Handles JSON strings, objects, and null/undefined values.
 *
 * @param meta - The meta value from the database (string, object, or null)
 * @returns A validated Record<string, unknown> or empty object
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

  const result = MetaSchema(parsed);
  if (result instanceof type.errors) {
    return {};
  }

  return result as Record<string, unknown>;
}

/**
 * Schema for validating a ContractMarkerRow from the database.
 * Validates the snake_case column structure returned by Postgres.
 * Note: updated_at can be a Date object or a string (which will be converted to Date).
 * Optional fields can be null or missing.
 */
const ContractMarkerRowSchema = type({
  core_hash: 'string',
  profile_hash: 'string',
  'contract_json?': 'unknown | null',
  'canonical_version?': 'number | null',
  'updated_at?': 'Date | string',
  'app_tag?': 'string | null',
  'meta?': 'unknown | null',
});

/**
 * Parses and validates a database row (snake_case) into an application record (camelCase).
 *
 * Validates the entire row structure using Arktype, then maps database column names
 * to application property names and normalizes the `meta` field:
 * - If `meta` is a JSON string, parses and validates it as a Record<string, unknown>
 * - If `meta` is already an object, validates it as a Record<string, unknown>
 * - If `meta` is null/undefined or validation fails, defaults to an empty object
 *
 * @param row - The unverified database row data (unknown)
 * @returns The validated application record with camelCase property names
 * @throws Error if the row structure is invalid
 */
export function parseContractMarkerRow(row: unknown): ContractMarkerRecord {
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

  // Convert updated_at to Date if it's a string, or use current date if missing
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
