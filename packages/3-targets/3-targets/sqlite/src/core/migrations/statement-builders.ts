import { APP_SPACE_ID } from '@prisma-next/framework-components/control';

export { APP_SPACE_ID };

export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export {
  CONTROL_TABLE_NAMES,
  LEDGER_TABLE_NAME,
  MARKER_TABLE_NAME,
} from '../control-tables';

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
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
