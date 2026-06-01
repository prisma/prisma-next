import { APP_SPACE_ID } from '@prisma-next/framework-components/control';

export { APP_SPACE_ID };

export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export const MARKER_TABLE_NAME = '_prisma_marker';
export const LEDGER_TABLE_NAME = '_prisma_ledger';

/**
 * Control tables the runner creates/manages. The planner must not drop these
 * when reconciling "extra" tables against the contract.
 */
export const CONTROL_TABLE_NAMES: ReadonlySet<string> = new Set([
  MARKER_TABLE_NAME,
  LEDGER_TABLE_NAME,
]);

/**
 * Schema for `_prisma_marker`. The `space TEXT PRIMARY KEY` shape
 * supports one row per loaded contract space (`'app'`,
 * `'<extension-id>'`, …); brand-new databases create this shape
 * directly. The migration runner detects pre-1.0 single-row markers
 * (no `space` column) at boot and fails with a structured
 * `LEGACY_MARKER_SHAPE` error rather than auto-rebuilding the table —
 * see `specs/framework-mechanism.spec.md § 2`.
 */
export const ensureMarkerTableStatement: SqlStatement = {
  sql: `CREATE TABLE IF NOT EXISTS _prisma_marker (
    space TEXT NOT NULL PRIMARY KEY DEFAULT '${APP_SPACE_ID}',
    core_hash TEXT NOT NULL,
    profile_hash TEXT NOT NULL,
    contract_json TEXT,
    canonical_version INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    app_tag TEXT,
    meta TEXT NOT NULL DEFAULT '{}',
    invariants TEXT NOT NULL DEFAULT '[]'
  )`,
  params: [],
};

export const ensureLedgerTableStatement: SqlStatement = {
  sql: `CREATE TABLE IF NOT EXISTS _prisma_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    space TEXT NOT NULL,
    migration_name TEXT NOT NULL,
    migration_hash TEXT NOT NULL,
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

export function readMarkerStatement(space: string): SqlStatement {
  return {
    sql: `SELECT
      core_hash,
      profile_hash,
      contract_json,
      canonical_version,
      updated_at,
      app_tag,
      meta,
      invariants
    FROM _prisma_marker
    WHERE space = ?`,
    params: [space],
  };
}

export interface WriteMarkerInput {
  /**
   * Logical space identifier for this marker row. Required at every
   * call site so the type system surfaces every place that needs to
   * thread the value (rather than letting an `?? APP_SPACE_ID`
   * fall-through silently collapse per-space markers onto the
   * `'app'` row). App-plan callers pass {@link APP_SPACE_ID}
   * (`'app'`); per-extension callers pass the extension's space id.
   */
  readonly space: string;
  readonly storageHash: string;
  readonly profileHash: string;
  readonly contractJson?: unknown;
  readonly canonicalVersion?: number | null;
  readonly appTag?: string | null;
  readonly meta?: Record<string, unknown>;
  /**
   * Invariants to write into `marker.invariants`. Stored as a JSON-encoded
   * TEXT array — SQLite has no native array type. The runner is responsible
   * for merging with the existing column (no SQL-side merge here, unlike
   * Postgres) before passing them in: BEGIN EXCLUSIVE on the migration
   * transaction makes the read-then-merge-then-write sequence safe.
   */
  readonly invariants: readonly string[];
}

export function buildWriteMarkerStatements(input: WriteMarkerInput): {
  readonly insert: SqlStatement;
  readonly update: SqlStatement;
} {
  const params: readonly unknown[] = [
    input.space,
    input.storageHash,
    input.profileHash,
    jsonParam(input.contractJson),
    input.canonicalVersion ?? null,
    input.appTag ?? null,
    jsonParam(input.meta ?? {}),
    jsonParam(input.invariants),
  ];

  return {
    insert: {
      sql: `INSERT INTO _prisma_marker (
        space,
        core_hash,
        profile_hash,
        contract_json,
        canonical_version,
        updated_at,
        app_tag,
        meta,
        invariants
      ) VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
        datetime('now'),
        ?,
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
        meta = ?,
        invariants = ?
      WHERE space = ?`,
      params: [
        input.storageHash,
        input.profileHash,
        jsonParam(input.contractJson),
        input.canonicalVersion ?? null,
        input.appTag ?? null,
        jsonParam(input.meta ?? {}),
        jsonParam(input.invariants),
        input.space,
      ],
    },
  };
}

export interface LedgerInsertInput {
  readonly space: string;
  readonly migrationName: string;
  readonly migrationHash: string;
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
      space,
      migration_name,
      migration_hash,
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
      ?,
      ?,
      ?,
      ?
    )`,
    params: [
      input.space,
      input.migrationName,
      input.migrationHash,
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
