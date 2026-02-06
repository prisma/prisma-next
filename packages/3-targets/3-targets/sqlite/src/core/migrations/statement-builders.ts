export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * Marker table per ADR 021 (SQLite uses a flat table name, no schemas).
 */
export const ensureMarkerTableStatement: SqlStatement = {
  sql: `create table if not exists prisma_contract_marker (
    id integer primary key,
    core_hash text not null,
    profile_hash text not null,
    contract_json text,
    canonical_version integer,
    updated_at text not null default (CURRENT_TIMESTAMP),
    app_tag text,
    meta text not null default '{}'
  )`,
  params: [],
};

/**
 * Minimal ledger table for audit/debug (SQLite flavor).
 */
export const ensureLedgerTableStatement: SqlStatement = {
  sql: `create table if not exists prisma_contract_ledger (
    id integer primary key autoincrement,
    created_at text not null default (CURRENT_TIMESTAMP),
    origin_core_hash text,
    origin_profile_hash text,
    destination_core_hash text not null,
    destination_profile_hash text,
    contract_json_before text,
    contract_json_after text,
    operations text not null
  )`,
  params: [],
};

export interface WriteMarkerInput {
  readonly coreHash: string;
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
    input.coreHash,
    input.profileHash,
    jsonParam(input.contractJson),
    input.canonicalVersion ?? null,
    input.appTag ?? null,
    jsonParam(input.meta ?? {}),
  ];

  return {
    insert: {
      sql: `insert into prisma_contract_marker (
        id,
        core_hash,
        profile_hash,
        contract_json,
        canonical_version,
        updated_at,
        app_tag,
        meta
      ) values (
        ?1,
        ?2,
        ?3,
        ?4,
        ?5,
        CURRENT_TIMESTAMP,
        ?6,
        ?7
      )`,
      params,
    },
    update: {
      sql: `update prisma_contract_marker set
        core_hash = ?2,
        profile_hash = ?3,
        contract_json = ?4,
        canonical_version = ?5,
        updated_at = CURRENT_TIMESTAMP,
        app_tag = ?6,
        meta = ?7
      where id = ?1`,
      params,
    },
  };
}

export interface LedgerInsertInput {
  readonly originCoreHash?: string | null;
  readonly originProfileHash?: string | null;
  readonly destinationCoreHash: string;
  readonly destinationProfileHash?: string | null;
  readonly contractJsonBefore?: unknown;
  readonly contractJsonAfter?: unknown;
  readonly operations: unknown;
}

export function buildLedgerInsertStatement(input: LedgerInsertInput): SqlStatement {
  return {
    sql: `insert into prisma_contract_ledger (
      origin_core_hash,
      origin_profile_hash,
      destination_core_hash,
      destination_profile_hash,
      contract_json_before,
      contract_json_after,
      operations
    ) values (
      ?1,
      ?2,
      ?3,
      ?4,
      ?5,
      ?6,
      ?7
    )`,
    params: [
      input.originCoreHash ?? null,
      input.originProfileHash ?? null,
      input.destinationCoreHash,
      input.destinationProfileHash ?? null,
      jsonParam(input.contractJsonBefore),
      jsonParam(input.contractJsonAfter),
      jsonParam(input.operations),
    ],
  };
}

function jsonParam(value: unknown): string {
  return JSON.stringify(value ?? null);
}
