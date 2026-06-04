import type { ControlDriverInstance } from '@prisma-next/framework-components/control';
import {
  type AnyQueryAst,
  type LoweredStatement,
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

export const marker = pgTable(
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

export const ledger = pgTable(
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

export const infoSchemaTables = pgTable(
  { name: 'tables', schema: 'information_schema' },
  { table_schema: text(), table_name: text() },
);

export const NOW = new RawExpr({
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

export function mergeInvariants(
  current: readonly string[],
  incoming: readonly string[],
): readonly string[] {
  return [...new Set([...current, ...incoming])].sort();
}

export async function execute(
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

export type PostgresMarkerDriver = MarkerDriver;
export type PostgresMarkerLower = Lower;
export type PostgresMarkerWriteDriver = ControlDriverInstance<'sql', 'postgres'>;
