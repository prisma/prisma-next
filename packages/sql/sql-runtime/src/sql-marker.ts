import type { MarkerStatement } from '@prisma-next/runtime-core';

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

export function readContractMarker(): MarkerStatement {
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
