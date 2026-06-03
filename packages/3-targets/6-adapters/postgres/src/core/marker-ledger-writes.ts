import type { ControlDriverInstance } from '@prisma-next/framework-components/control';
import {
  AndExpr,
  type AnyQueryAst,
  BinaryExpr,
  ColumnRef,
  type InsertValue,
  type LoweredStatement,
  ProjectionItem,
} from '@prisma-next/sql-relational-core/ast';
import {
  dbExpr,
  excludedColumn,
  insert,
  param,
  tableRef,
  update,
  upsert,
} from '@prisma-next/sql-relational-core/contract-free';
import {
  createControlCodecRegistry,
  deriveParamMetadata,
  encodeParamsWithMetadata,
} from '@prisma-next/sql-runtime';
import {
  PG_INT4_CODEC_ID,
  PG_JSONB_CODEC_ID,
  PG_TEXT_ARRAY_CODEC_ID,
  PG_TEXT_CODEC_ID,
  PG_TIMESTAMPTZ_CODEC_ID,
} from '@prisma-next/target-postgres/codec-ids';
import { postgresCodecRegistry } from '@prisma-next/target-postgres/codecs';

const CONTROL_CODECS = createControlCodecRegistry(postgresCodecRegistry);

const MARKER_TABLE = tableRef('marker', { schema: 'prisma_contract' });
const LEDGER_TABLE = tableRef('ledger', { schema: 'prisma_contract' });
const NOW = dbExpr('now()', { codecId: PG_TIMESTAMPTZ_CODEC_ID, nullable: false });

type Lower = (query: AnyQueryAst) => LoweredStatement;

/**
 * Unions the current invariant set with the incoming one, dedupes, and sorts
 * ascending so the persisted array is stable and order-independent. The merge
 * runs in TS (uniform across dialects) rather than SQL-side, so SQLite — which
 * stores `invariants` as JSON `TEXT` with no array operators — accumulate-dedupes
 * exactly like Postgres instead of overwriting.
 */
function mergeInvariants(
  current: readonly string[],
  incoming: readonly string[],
): readonly string[] {
  return [...new Set([...current, ...incoming])].sort();
}

/**
 * Lowers a control-plane DML AST and runs it through the driver. Control DML is
 * contract-free: each value carries its codec at the value site, so encoding
 * resolves purely from the AST-supplied `CodecRef`s against the Postgres
 * descriptor registry — no `ExecutionContext` or contract walk. The lowered
 * params are raw JS values (no bind slots); they are encoded through their
 * codecs before reaching the driver. Returns the result rows so CAS callers can
 * inspect a `RETURNING` projection.
 */
async function execute(
  lower: Lower,
  driver: ControlDriverInstance<'sql', 'postgres'>,
  query: AnyQueryAst,
): Promise<readonly Record<string, unknown>[]> {
  const lowered = lower(query);
  const values = lowered.params.map((slot) => {
    if (slot.kind === 'literal') return slot.value;
    throw new Error('Postgres control DML lowered to a bind parameter, which is unsupported');
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

function markerInsertRow(
  space: string,
  destination: {
    readonly storageHash: string;
    readonly profileHash: string;
    readonly invariants?: readonly string[];
  },
): Readonly<Record<string, InsertValue>> {
  return {
    space: param(space, { codecId: PG_TEXT_CODEC_ID }),
    core_hash: param(destination.storageHash, { codecId: PG_TEXT_CODEC_ID }),
    profile_hash: param(destination.profileHash, { codecId: PG_TEXT_CODEC_ID }),
    contract_json: param(null, { codecId: PG_JSONB_CODEC_ID }),
    canonical_version: param(null, { codecId: PG_INT4_CODEC_ID }),
    updated_at: NOW,
    app_tag: param(null, { codecId: PG_TEXT_CODEC_ID }),
    meta: param({}, { codecId: PG_JSONB_CODEC_ID }),
    invariants: param(destination.invariants ?? [], { codecId: PG_TEXT_ARRAY_CODEC_ID }),
  };
}

/** Insert-only initial stamp; fails when the space row already exists. */
export async function insertMarker(
  lower: Lower,
  driver: ControlDriverInstance<'sql', 'postgres'>,
  space: string,
  destination: {
    readonly storageHash: string;
    readonly profileHash: string;
    readonly invariants?: readonly string[];
  },
): Promise<void> {
  await execute(lower, driver, insert(MARKER_TABLE, markerInsertRow(space, destination)));
}

export async function initMarker(
  lower: Lower,
  driver: ControlDriverInstance<'sql', 'postgres'>,
  space: string,
  destination: {
    readonly storageHash: string;
    readonly profileHash: string;
    readonly invariants?: readonly string[];
  },
): Promise<void> {
  const row = markerInsertRow(space, destination);
  const query = upsert({
    table: MARKER_TABLE,
    row,
    conflictColumns: ['space'],
    set: {
      core_hash: excludedColumn('core_hash'),
      profile_hash: excludedColumn('profile_hash'),
      contract_json: excludedColumn('contract_json'),
      canonical_version: excludedColumn('canonical_version'),
      updated_at: NOW,
      app_tag: excludedColumn('app_tag'),
      meta: excludedColumn('meta'),
      invariants: excludedColumn('invariants'),
    },
  });
  await execute(lower, driver, query);
}

export async function updateMarker(
  lower: Lower,
  driver: ControlDriverInstance<'sql', 'postgres'>,
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
  const query = update({
    table: MARKER_TABLE,
    set: {
      core_hash: param(destination.storageHash, { codecId: PG_TEXT_CODEC_ID }),
      profile_hash: param(destination.profileHash, { codecId: PG_TEXT_CODEC_ID }),
      updated_at: NOW,
      ...(mergedInvariants !== undefined
        ? { invariants: param(mergedInvariants, { codecId: PG_TEXT_ARRAY_CODEC_ID }) }
        : {}),
    },
    where: AndExpr.of([
      BinaryExpr.eq(ColumnRef.of('marker', 'space'), param(space, { codecId: PG_TEXT_CODEC_ID })),
      BinaryExpr.eq(
        ColumnRef.of('marker', 'core_hash'),
        param(expectedFrom, { codecId: PG_TEXT_CODEC_ID }),
      ),
    ]),
    returning: [ProjectionItem.of('space', ColumnRef.of('marker', 'space'))],
  });
  const rows = await execute(lower, driver, query);
  return rows.length > 0;
}

export async function writeLedgerEntry(
  lower: Lower,
  driver: ControlDriverInstance<'sql', 'postgres'>,
  space: string,
  entry: {
    readonly from: string;
    readonly to: string;
    readonly migrationName: string;
    readonly migrationHash: string;
    readonly operations: readonly unknown[];
  },
): Promise<void> {
  const query = insert(LEDGER_TABLE, {
    space: param(space, { codecId: PG_TEXT_CODEC_ID }),
    migration_name: param(entry.migrationName, { codecId: PG_TEXT_CODEC_ID }),
    migration_hash: param(entry.migrationHash, { codecId: PG_TEXT_CODEC_ID }),
    origin_core_hash: param(entry.from, { codecId: PG_TEXT_CODEC_ID }),
    destination_core_hash: param(entry.to, { codecId: PG_TEXT_CODEC_ID }),
    operations: param(entry.operations, { codecId: PG_JSONB_CODEC_ID }),
  });
  await execute(lower, driver, query);
}
