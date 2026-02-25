import { bigintJsonReplacer } from '@prisma-next/contract/types';

export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export const ensurePrismaContractSchemaStatement: SqlStatement = {
  sql: 'create schema if not exists prisma_contract',
  params: [],
};

export const ensureMarkerTableStatement: SqlStatement = {
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

export const ensureLedgerTableStatement: SqlStatement = {
  sql: `create table if not exists prisma_contract.ledger (
    id bigserial primary key,
    created_at timestamptz not null default now(),
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

export interface WriteMarkerInput {
  readonly storageHash: string;
  readonly profileHash: string;
  readonly contractJson?: unknown;
  readonly canonicalVersion?: number | null;
  readonly appTag?: string | null;
  readonly meta?: Record<string, unknown>;
}

export function buildWriteMarkerStatements(input: WriteMarkerInput): {
  readonly insert: SqlStatement;
  readonly update: SqlStatement;
} {
  const params: readonly unknown[] = [
    1,
    input.storageHash,
    input.profileHash,
    jsonParam(input.contractJson),
    input.canonicalVersion ?? null,
    input.appTag ?? null,
    jsonParam(input.meta ?? {}),
  ];

  return {
    insert: {
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
      params,
    },
    update: {
      sql: `update prisma_contract.marker set
        core_hash = $2,
        profile_hash = $3,
        contract_json = $4::jsonb,
        canonical_version = $5,
        updated_at = now(),
        app_tag = $6,
        meta = $7::jsonb
      where id = $1`,
      params,
    },
  };
}

export interface LedgerInsertInput {
  readonly originStorageHash?: string | null;
  readonly originProfileHash?: string | null;
  readonly destinationStorageHash: string;
  readonly destinationProfileHash?: string | null;
  readonly contractJsonBefore?: unknown;
  readonly contractJsonAfter?: unknown;
  readonly operations: unknown;
}

export function buildLedgerInsertStatement(input: LedgerInsertInput): SqlStatement {
  return {
    sql: `insert into prisma_contract.ledger (
      origin_core_hash,
      origin_profile_hash,
      destination_core_hash,
      destination_profile_hash,
      contract_json_before,
      contract_json_after,
      operations
    ) values (
      $1,
      $2,
      $3,
      $4,
      $5::jsonb,
      $6::jsonb,
      $7::jsonb
    )`,
    params: [
      input.originStorageHash ?? null,
      input.originProfileHash ?? null,
      input.destinationStorageHash,
      input.destinationProfileHash ?? null,
      jsonParam(input.contractJsonBefore),
      jsonParam(input.contractJsonAfter),
      jsonParam(input.operations),
    ],
  };
}

function jsonParam(value: unknown): string {
  return JSON.stringify(value ?? null, bigintJsonReplacer);
}
