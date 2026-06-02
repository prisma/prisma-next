import { APP_SPACE_ID } from '@prisma-next/framework-components/control';

export { APP_SPACE_ID };

export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export const ensurePrismaContractSchemaStatement: SqlStatement = {
  sql: 'create schema if not exists prisma_contract',
  params: [],
};

/**
 * Schema for `prisma_contract.marker`. The `space text` primary key
 * supports one row per loaded contract space (`'app'`,
 * `'<extension-id>'`, …); on a brand-new database `CREATE TABLE IF NOT
 * EXISTS` produces this shape directly. The migration runner detects
 * pre-1.0 single-row markers (no `space` column) at boot and fails with
 * a structured `LEGACY_MARKER_SHAPE` error rather than auto-migrating —
 * see `specs/framework-mechanism.spec.md § 2`.
 */
export const ensureMarkerTableStatement: SqlStatement = {
  sql: `create table if not exists prisma_contract.marker (
    space text not null primary key default '${APP_SPACE_ID}',
    core_hash text not null,
    profile_hash text not null,
    contract_json jsonb,
    canonical_version int,
    updated_at timestamptz not null default now(),
    app_tag text,
    meta jsonb not null default '{}',
    invariants text[] not null default '{}'
  )`,
  params: [],
};

export const ensureLedgerTableStatement: SqlStatement = {
  sql: `create table if not exists prisma_contract.ledger (
    id bigserial primary key,
    created_at timestamptz not null default now(),
    space text not null,
    migration_name text not null,
    migration_hash text not null,
    origin_core_hash text,
    origin_profile_hash text,
    destination_core_hash text not null,
    destination_profile_hash text,
    contract_json_before jsonb,
    contract_json_after jsonb,
    operations jsonb not null
  )`,
  params: [],
};
