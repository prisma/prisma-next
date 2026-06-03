import { parseContractMarkerRow } from '@prisma-next/family-sql/verify';
import type { ControlDriverInstance } from '@prisma-next/framework-components/control';
import {
  type AnyQueryAst,
  type LoweredStatement,
  type MarkerReadResult,
  RawExpr,
} from '@prisma-next/sql-relational-core/ast';
import {
  createControlCodecRegistry,
  deriveParamMetadata,
  encodeParamsWithMetadata,
} from '@prisma-next/sql-runtime';
import { SQLITE_DATETIME_CODEC_ID } from '@prisma-next/target-sqlite/codec-ids';
import { sqliteCodecRegistry } from '@prisma-next/target-sqlite/codecs';
import {
  datetime,
  integer,
  jsonText,
  sqliteTable,
  text,
} from '@prisma-next/target-sqlite/contract-free';

const CONTROL_CODECS = createControlCodecRegistry(sqliteCodecRegistry);

const marker = sqliteTable('_prisma_marker', {
  space: text(),
  core_hash: text(),
  profile_hash: text(),
  contract_json: jsonText({ nullable: true }),
  canonical_version: integer({ nullable: true }),
  updated_at: datetime(),
  app_tag: text({ nullable: true }),
  meta: jsonText({ nullable: true }),
  invariants: jsonText(),
});

const ledger = sqliteTable('_prisma_ledger', {
  space: text(),
  migration_name: text(),
  migration_hash: text(),
  origin_core_hash: text(),
  destination_core_hash: text(),
  operations: jsonText(),
});

const sqliteCatalog = sqliteTable('sqlite_master', { type: text(), name: text() });

const NOW = new RawExpr({
  parts: ["datetime('now')"],
  returns: { codecId: SQLITE_DATETIME_CODEC_ID, nullable: false },
});

type Lower = (query: AnyQueryAst) => LoweredStatement;

type MarkerDriver = {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: ReadonlyArray<Row> }>;
};

function mergeInvariants(
  current: readonly string[],
  incoming: readonly string[],
): readonly string[] {
  return [...new Set([...current, ...incoming])].sort();
}

async function execute(
  lower: Lower,
  driver: MarkerDriver,
  query: AnyQueryAst,
): Promise<readonly Record<string, unknown>[]> {
  const lowered = lower(query);
  const values = lowered.params.map((slot) => {
    if (slot.kind === 'literal') return slot.value;
    throw new Error('SQLite control DML lowered to a bind parameter, which is unsupported');
  });
  const encoded = await encodeParamsWithMetadata(
    values,
    deriveParamMetadata(query),
    {},
    CONTROL_CODECS,
  );
  const result = await driver.query(lowered.sql, encoded);
  return result.rows;
}

export async function readMarker(
  lower: Lower,
  driver: MarkerDriver,
  space: string,
): Promise<MarkerReadResult> {
  const probe = sqliteCatalog
    .select(sqliteCatalog.name)
    .where(sqliteCatalog.type.eq('table').and(sqliteCatalog.name.eq('_prisma_marker')))
    .build();
  const exists = await execute(lower, driver, probe);
  if (exists.length === 0) return { kind: 'no-table' };

  const fetch = marker
    .select(
      marker.core_hash,
      marker.profile_hash,
      marker.contract_json,
      marker.canonical_version,
      marker.updated_at,
      marker.app_tag,
      marker.meta,
      marker.invariants,
    )
    .where(marker.space.eq(space))
    .build();
  const result = await execute(lower, driver, fetch);
  const row = result[0];
  if (!row) return { kind: 'absent' };
  return { kind: 'present', record: parseContractMarkerRow(decodeSqliteMarkerRow(row)) };
}

export async function insertMarker(
  lower: Lower,
  driver: ControlDriverInstance<'sql', 'sqlite'>,
  space: string,
  destination: {
    readonly storageHash: string;
    readonly profileHash: string;
    readonly invariants?: readonly string[];
  },
): Promise<void> {
  await execute(
    lower,
    driver,
    marker
      .insert({
        space,
        core_hash: destination.storageHash,
        profile_hash: destination.profileHash,
        contract_json: null,
        canonical_version: null,
        updated_at: NOW,
        app_tag: null,
        meta: {},
        invariants: destination.invariants ?? [],
      })
      .build(),
  );
}

export async function initMarker(
  lower: Lower,
  driver: ControlDriverInstance<'sql', 'sqlite'>,
  space: string,
  destination: {
    readonly storageHash: string;
    readonly profileHash: string;
    readonly invariants?: readonly string[];
  },
): Promise<void> {
  await execute(
    lower,
    driver,
    marker
      .upsert({
        space,
        core_hash: destination.storageHash,
        profile_hash: destination.profileHash,
        contract_json: null,
        canonical_version: null,
        updated_at: NOW,
        app_tag: null,
        meta: {},
        invariants: destination.invariants ?? [],
      })
      .onConflict(marker.space)
      .doUpdate((excluded) => ({
        core_hash: excluded.core_hash,
        profile_hash: excluded.profile_hash,
        contract_json: excluded.contract_json,
        canonical_version: excluded.canonical_version,
        updated_at: NOW,
        app_tag: excluded.app_tag,
        meta: excluded.meta,
        invariants: excluded.invariants,
      }))
      .build(),
  );
}

export async function updateMarker(
  lower: Lower,
  driver: ControlDriverInstance<'sql', 'sqlite'>,
  space: string,
  expectedFrom: string,
  destination: {
    readonly storageHash: string;
    readonly profileHash: string;
    readonly invariants?: readonly string[];
  },
  currentInvariants: readonly string[] = [],
): Promise<boolean> {
  const mergedInvariants =
    destination.invariants === undefined
      ? undefined
      : mergeInvariants(currentInvariants, destination.invariants);

  const query = marker
    .update()
    .set({
      core_hash: destination.storageHash,
      profile_hash: destination.profileHash,
      updated_at: NOW,
      ...(mergedInvariants !== undefined ? { invariants: mergedInvariants } : {}),
    })
    .where(marker.space.eq(space).and(marker.core_hash.eq(expectedFrom)))
    .returning(marker.space)
    .build();

  const rows = await execute(lower, driver, query);
  return rows.length > 0;
}

export async function writeLedgerEntry(
  lower: Lower,
  driver: ControlDriverInstance<'sql', 'sqlite'>,
  space: string,
  entry: {
    readonly from: string;
    readonly to: string;
    readonly migrationName: string;
    readonly migrationHash: string;
    readonly operations: readonly unknown[];
  },
): Promise<void> {
  await execute(
    lower,
    driver,
    ledger
      .insert({
        space,
        migration_name: entry.migrationName,
        migration_hash: entry.migrationHash,
        origin_core_hash: entry.from,
        destination_core_hash: entry.to,
        operations: entry.operations,
      })
      .build(),
  );
}

export function decodeSqliteMarkerRow(row: unknown): unknown {
  if (typeof row !== 'object' || row === null || !('invariants' in row)) {
    return row;
  }
  const record = row as { invariants: unknown };
  if (typeof record.invariants !== 'string') return row;
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.invariants);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid contract marker row: invariants is not valid JSON: ${detail}`);
  }
  return { ...record, invariants: parsed };
}
