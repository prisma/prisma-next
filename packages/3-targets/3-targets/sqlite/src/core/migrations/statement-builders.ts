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
 * Schema for `_prisma_marker` after the contract-spaces migration: the
 * single-row `id INTEGER ... CHECK (id = 1)` is replaced with a `space
 * TEXT PRIMARY KEY` so one row per loaded contract space (`'app'`,
 * `'<extension-id>'`, …) is supported. Brand-new databases create this
 * shape directly; legacy databases are upgraded by `migrateMarkerSchemaSqlite()`
 * via the rebuild-table approach SQLite requires for primary-key changes.
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

/**
 * Minimal driver shape used by `migrateMarkerSchemaSqlite`. Kept local so
 * the helper doesn't depend on any control-driver package — the runner
 * supplies whatever value is on hand.
 */
interface SqliteMigrateDriver {
  query<TRow = unknown>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: readonly TRow[] }>;
}

interface PragmaTableInfoRow {
  readonly name: string;
}

/**
 * Idempotent migration that promotes a legacy single-row `_prisma_marker`
 * to the per-space shape defined by `ensureMarkerTableStatement`.
 *
 * SQLite cannot `ALTER TABLE` a primary key in place, so the upgrade
 * path is the canonical rebuild-table dance: create a new table in the
 * target shape, copy rows in, drop the old table, rename. The function
 * is a no-op on:
 *
 * - a fresh database (table just created in the new shape with `space`
 *   present and no `id`),
 * - an already-migrated database (likewise),
 *
 * and performs the rebuild only on a legacy single-row database (`id`
 * present, `space` absent, single row keyed by `id = 1`).
 *
 * Concurrency: the caller (the SQLite runner) wraps `ensureControlTables`
 * in a `BEGIN EXCLUSIVE`, so concurrent boots serialize on the database
 * lock and the rebuild is observed atomically.
 *
 * @see specs/framework-mechanism.spec.md § 2.
 */
export async function migrateMarkerSchemaSqlite(driver: SqliteMigrateDriver): Promise<void> {
  const tableInfo = await driver.query<PragmaTableInfoRow>(
    `PRAGMA table_info("${MARKER_TABLE_NAME}")`,
  );
  const columnNames = new Set(tableInfo.rows.map((row) => row.name));
  const hasSpace = columnNames.has('space');
  const hasId = columnNames.has('id');
  if (hasSpace && !hasId) {
    return; // already migrated (also covers fresh databases)
  }
  if (!hasId) {
    return; // table absent or some other unexpected shape — leave to ensure*Statement
  }

  // Legacy shape detected. Use a temporary table to rebuild around the
  // primary-key change. `IF NOT EXISTS` is a defensive guard for the
  // (extremely unlikely) case where a previous half-applied migration
  // left a stranded `_prisma_marker_new`; the matching DROP at the end
  // of the dance makes the steady state clean.
  await driver.query(
    `CREATE TABLE IF NOT EXISTS _prisma_marker_new (
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
  );
  await driver.query(
    `INSERT INTO _prisma_marker_new (
      space,
      core_hash,
      profile_hash,
      contract_json,
      canonical_version,
      updated_at,
      app_tag,
      meta,
      invariants
    )
    SELECT
      '${APP_SPACE_ID}',
      core_hash,
      profile_hash,
      contract_json,
      canonical_version,
      updated_at,
      app_tag,
      meta,
      invariants
    FROM _prisma_marker`,
  );
  await driver.query('DROP TABLE _prisma_marker');
  await driver.query('ALTER TABLE _prisma_marker_new RENAME TO _prisma_marker');
}

export function readMarkerStatement(space: string = APP_SPACE_ID): SqlStatement {
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
   * Logical space identifier for this marker row. Defaults to
   * {@link APP_SPACE_ID} (`'app'`) so existing single-app callers keep
   * working without modification.
   */
  readonly space?: string;
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
    input.space ?? APP_SPACE_ID,
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
        input.space ?? APP_SPACE_ID,
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
