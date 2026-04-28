import type { MarkerStatement } from '@prisma-next/sql-relational-core/ast';

export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export interface WriteMarkerInput {
  readonly storageHash: string;
  readonly profileHash: string;
  readonly contractJson?: unknown;
  readonly canonicalVersion?: number;
  readonly appTag?: string;
  readonly meta?: Record<string, unknown>;
  /**
   * Applied-invariants set on the marker.
   *
   * - `undefined` → existing column left untouched. Sign and
   *   verify-database paths use this; they don't accumulate invariants.
   * - explicit value (including `[]`) → column overwritten with
   *   exactly that value.
   */
  readonly invariants?: readonly string[];
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
    meta jsonb not null default '{}',
    invariants text[] not null default '{}'
  )`,
  params: [],
};

export function readContractMarker(): MarkerStatement {
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

export interface WriteContractMarkerStatements {
  readonly insert: SqlStatement;
  readonly update: SqlStatement;
}

/**
 * Variable columns that participate in INSERT/UPDATE alongside the
 * always-on `id = $1` and `updated_at = now()`. Order here pins both
 * the SQL column order and the positional placeholder numbers.
 * `invariants` only appears when the caller supplies it — see
 * `WriteMarkerInput.invariants`.
 */
function markerColumns(
  input: WriteMarkerInput,
): ReadonlyArray<{ readonly name: string; readonly expr: string; readonly param: unknown }> {
  return [
    { name: 'core_hash', expr: '$2', param: input.storageHash },
    { name: 'profile_hash', expr: '$3', param: input.profileHash },
    { name: 'contract_json', expr: '$4::jsonb', param: input.contractJson ?? null },
    { name: 'canonical_version', expr: '$5', param: input.canonicalVersion ?? null },
    { name: 'app_tag', expr: '$6', param: input.appTag ?? null },
    { name: 'meta', expr: '$7::jsonb', param: JSON.stringify(input.meta ?? {}) },
    ...(input.invariants !== undefined
      ? [{ name: 'invariants', expr: '$8::text[]', param: input.invariants }]
      : []),
  ];
}

export function writeContractMarker(input: WriteMarkerInput): WriteContractMarkerStatements {
  const cols = markerColumns(input);
  const params: readonly unknown[] = [1, ...cols.map((c) => c.param)];

  // `updated_at = now()` is a SQL literal with no parameter slot, so it
  // sits outside `cols` and is appended directly to each statement.
  const insertColumns = ['id', ...cols.map((c) => c.name), 'updated_at'].join(', ');
  const insertValues = ['$1', ...cols.map((c) => c.expr), 'now()'].join(', ');
  const setClauses = [...cols.map((c) => `${c.name} = ${c.expr}`), 'updated_at = now()'].join(', ');

  return {
    insert: {
      sql: `insert into prisma_contract.marker (${insertColumns}) values (${insertValues})`,
      params,
    },
    update: {
      sql: `update prisma_contract.marker set ${setClauses} where id = $1`,
      params,
    },
  };
}
