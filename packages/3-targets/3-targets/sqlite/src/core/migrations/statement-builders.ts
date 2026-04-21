export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export const ensureMarkerTableStatement: SqlStatement = {
  sql: `CREATE TABLE IF NOT EXISTS _prisma_marker (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    core_hash TEXT NOT NULL,
    profile_hash TEXT NOT NULL,
    contract_json TEXT,
    canonical_version INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    app_tag TEXT,
    meta TEXT NOT NULL DEFAULT '{}'
  )`,
  params: [],
};

export const ensureLedgerTableStatement: SqlStatement = {
  sql: `CREATE TABLE IF NOT EXISTS _prisma_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    origin_core_hash TEXT,
    origin_profile_hash TEXT,
    destination_core_hash TEXT NOT NULL,
    destination_profile_hash TEXT,
    contract_json_before TEXT,
    contract_json_after TEXT,
    operations TEXT NOT NULL
  )`,
  params: [],
};

export function readMarkerStatement(): SqlStatement {
  return {
    sql: `SELECT
      core_hash,
      profile_hash,
      contract_json,
      canonical_version,
      updated_at,
      app_tag,
      meta
    FROM _prisma_marker
    WHERE id = ?`,
    params: [1],
  };
}

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
      sql: `INSERT INTO _prisma_marker (
        id,
        core_hash,
        profile_hash,
        contract_json,
        canonical_version,
        updated_at,
        app_tag,
        meta
      ) VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
        datetime('now'),
        ?,
        ?
      )`,
      params,
    },
    update: {
      sql: `UPDATE _prisma_marker SET
        core_hash = ?,
        profile_hash = ?,
        contract_json = ?,
        canonical_version = ?,
        updated_at = datetime('now'),
        app_tag = ?,
        meta = ?
      WHERE id = ?`,
      params: [
        input.storageHash,
        input.profileHash,
        jsonParam(input.contractJson),
        input.canonicalVersion ?? null,
        input.appTag ?? null,
        jsonParam(input.meta ?? {}),
        1,
      ],
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
    sql: `INSERT INTO _prisma_ledger (
      origin_core_hash,
      origin_profile_hash,
      destination_core_hash,
      destination_profile_hash,
      contract_json_before,
      contract_json_after,
      operations
    ) VALUES (
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?
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
  return JSON.stringify(value ?? null);
}
