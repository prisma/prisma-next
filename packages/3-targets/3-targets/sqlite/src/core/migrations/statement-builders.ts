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
   * fall-through silently collapse multi-space markers onto the
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
