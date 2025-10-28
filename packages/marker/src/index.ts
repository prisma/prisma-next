export interface MarkerClient {
  query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface UpsertMarkerInput {
  readonly coreHash: string;
  readonly profileHash: string;
  readonly contractJson?: unknown;
  readonly canonicalVersion?: number;
  readonly appTag?: string;
  readonly meta?: Record<string, unknown>;
}

export interface MarkerRecord {
  readonly coreHash: string;
  readonly profileHash: string;
  readonly contractJson: unknown | null;
  readonly canonicalVersion: number | null;
  readonly updatedAt: Date;
  readonly appTag: string | null;
  readonly meta: Record<string, unknown>;
}

const CREATE_SCHEMA_SQL = 'create schema if not exists prisma_contract';

const CREATE_TABLE_SQL = `
create table if not exists prisma_contract.marker (
  id smallint primary key default 1,
  core_hash text not null,
  profile_hash text not null,
  contract_json jsonb,
  canonical_version int,
  updated_at timestamptz not null default now(),
  app_tag text,
  meta jsonb not null default '{}'
)
`;

const UPSERT_SQL = `
insert into prisma_contract.marker (
  id,
  core_hash,
  profile_hash,
  contract_json,
  canonical_version,
  updated_at,
  app_tag,
  meta
)
values (
  1,
  $1,
  $2,
  $3,
  $4,
  now(),
  $5,
  COALESCE($6::jsonb, '{}'::jsonb)
)
on conflict (id)
do update set
  core_hash = excluded.core_hash,
  profile_hash = excluded.profile_hash,
  contract_json = excluded.contract_json,
  canonical_version = excluded.canonical_version,
  updated_at = now(),
  app_tag = excluded.app_tag,
  meta = excluded.meta;
`;

interface MarkerRow {
  core_hash: string;
  profile_hash: string;
  contract_json: unknown | null;
  canonical_version: number | null;
  updated_at: Date;
  app_tag: string | null;
  meta: Record<string, unknown> | null;
}

const READ_SQL = `
select
  core_hash,
  profile_hash,
  contract_json,
  canonical_version,
  updated_at,
  app_tag,
  meta
from prisma_contract.marker
where id = 1
`;

function toJson(value: unknown | undefined): unknown | null {
  if (value === undefined) {
    return null;
  }

  return value;
}

export async function upsertMarker(client: MarkerClient, input: UpsertMarkerInput): Promise<void> {
  await client.query(CREATE_SCHEMA_SQL);
  await client.query(CREATE_TABLE_SQL);

  await client.query(UPSERT_SQL, [
    input.coreHash,
    input.profileHash,
    toJson(input.contractJson),
    input.canonicalVersion ?? null,
    input.appTag ?? null,
    JSON.stringify(input.meta ?? {}),
  ]);
}

export async function readMarker(client: MarkerClient): Promise<MarkerRecord | null> {
  try {
    const result = await client.query<MarkerRow>(READ_SQL);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      coreHash: row.core_hash,
      profileHash: row.profile_hash,
      contractJson: row.contract_json,
      canonicalVersion: row.canonical_version,
      updatedAt: row.updated_at,
      appTag: row.app_tag,
      meta: row.meta ?? {},
    };
  } catch (error) {
    if (isMissingSchemaOrTable(error)) {
      return null;
    }

    throw error;
  }
}

function isMissingSchemaOrTable(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = (error as { code?: string }).code;
  return code === '3F000' || code === '42P01';
}
