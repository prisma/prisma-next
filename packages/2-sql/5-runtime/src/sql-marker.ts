import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import type { MarkerStatement } from '@prisma-next/sql-relational-core/ast';

export { APP_SPACE_ID };

export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export const ensureSchemaStatement: SqlStatement = {
  sql: 'create schema if not exists prisma_contract',
  params: [],
};

/**
 * Schema for `prisma_contract.marker`. The `space text` primary key
 * supports one row per loaded contract space (`'app'`,
 * `'<extension-id>'`, …); brand-new databases create this shape
 * directly. Pre-1.0 single-row markers (no `space` column) are not
 * auto-migrated — the target-specific migration runner detects the
 * legacy shape at boot and surfaces a structured `LEGACY_MARKER_SHAPE`
 * failure pointing the operator at re-running `dbInit`.
 *
 * @see specs/framework-mechanism.spec.md § 2.
 */
export const ensureTableStatement: SqlStatement = {
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

export function readContractMarker(space: string): MarkerStatement {
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
    where space = $1`,
    params: [space],
  };
}
