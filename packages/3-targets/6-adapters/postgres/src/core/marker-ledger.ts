import { parseContractMarkerRow } from '@prisma-next/family-sql/verify';
import type { ControlDriverInstance } from '@prisma-next/framework-components/control';
import {
  type AnyQueryAst,
  type LoweredStatement,
  type MarkerReadResult,
  RawExpr,
} from '@prisma-next/sql-relational-core/ast';
import {
  createAstCodecRegistry,
  deriveParamMetadata,
  encodeParamsWithMetadata,
} from '@prisma-next/sql-runtime';
import { PG_TIMESTAMPTZ_CODEC_ID } from '@prisma-next/target-postgres/codec-ids';
import { postgresCodecRegistry } from '@prisma-next/target-postgres/codecs';
import {
  int4,
  jsonb,
  pgTable,
  text,
  textArray,
  timestamptz,
} from '@prisma-next/target-postgres/contract-free';

const CONTROL_CODECS = createAstCodecRegistry(postgresCodecRegistry);

const marker = pgTable(
  { name: 'marker', schema: 'prisma_contract' },
  {
    space: text(),
    core_hash: text(),
    profile_hash: text(),
    contract_json: jsonb({ nullable: true }),
    canonical_version: int4({ nullable: true }),
    updated_at: timestamptz(),
    app_tag: text({ nullable: true }),
    meta: jsonb({ nullable: true }),
    invariants: textArray(),
  },
);

const ledger = pgTable(
  { name: 'ledger', schema: 'prisma_contract' },
  {
    space: text(),
    migration_name: text(),
    migration_hash: text(),
    origin_core_hash: text(),
    destination_core_hash: text(),
    operations: jsonb(),
  },
);

const infoSchemaTables = pgTable(
  { name: 'tables', schema: 'information_schema' },
  { table_schema: text(), table_name: text() },
);

const NOW = new RawExpr({
  parts: ['now()'],
  returns: { codecId: PG_TIMESTAMPTZ_CODEC_ID, nullable: false },
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

export async function readMarker(
  lower: Lower,
  driver: MarkerDriver,
  space: string,
): Promise<MarkerReadResult> {
  const probe = infoSchemaTables
    .select(infoSchemaTables.table_schema)
    .where(
      infoSchemaTables.table_schema
        .eq('prisma_contract')
        .and(infoSchemaTables.table_name.eq('marker')),
    )
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
  return { kind: 'present', record: parseContractMarkerRow(row) };
}

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
  driver: ControlDriverInstance<'sql', 'postgres'>,
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
