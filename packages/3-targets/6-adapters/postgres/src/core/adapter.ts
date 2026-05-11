import type { CodecLookup } from '@prisma-next/framework-components/codec';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import type {
  Adapter,
  AdapterProfile,
  AnyQueryAst,
  LowererContext,
  MarkerReadResult,
  SqlQueryable,
} from '@prisma-next/sql-relational-core/ast';
import { parseContractMarkerRow } from '@prisma-next/sql-runtime';
import { createPostgresBuiltinCodecLookup } from './codec-lookup';
import { renderLoweredSql } from './sql-renderer';
import type { PostgresAdapterOptions, PostgresContract, PostgresLoweredStatement } from './types';

const defaultCapabilities = Object.freeze({
  postgres: {
    orderBy: true,
    limit: true,
    lateral: true,
    jsonAgg: true,
    returning: true,
  },
  sql: {
    enums: true,
    returning: true,
    defaultInInsert: true,
  },
});

class PostgresAdapterImpl
  implements Adapter<AnyQueryAst, PostgresContract, PostgresLoweredStatement>
{
  // These fields make the adapter instance structurally compatible with RuntimeAdapterInstance<'sql', 'postgres'> without introducing a runtime-plane dependency.
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;

  readonly profile: AdapterProfile<'postgres'>;
  private readonly codecLookup: CodecLookup;

  constructor(options?: PostgresAdapterOptions) {
    this.codecLookup = options?.codecLookup ?? createPostgresBuiltinCodecLookup();
    this.profile = Object.freeze({
      id: options?.profileId ?? 'postgres/default@1',
      target: 'postgres',
      capabilities: defaultCapabilities,
      readMarker: (queryable: SqlQueryable) => readPostgresMarker(queryable),
    });
  }

  lower(ast: AnyQueryAst, context: LowererContext<PostgresContract>): PostgresLoweredStatement {
    return renderLoweredSql(ast, context.contract, this.codecLookup);
  }
}

async function readPostgresMarker(queryable: SqlQueryable): Promise<MarkerReadResult> {
  const exists = await queryable.query(
    'select 1 from information_schema.tables where table_schema = $1 and table_name = $2',
    ['prisma_contract', 'marker'],
  );
  if (exists.rows.length === 0) {
    return { kind: 'no-table' };
  }

  const result = await queryable.query(
    'select core_hash, profile_hash, contract_json, canonical_version, updated_at, app_tag, meta, invariants from prisma_contract.marker where space = $1',
    [APP_SPACE_ID],
  );
  const row = result.rows[0];
  if (!row) {
    return { kind: 'absent' };
  }
  // Postgres' driver hydrates `text[]` columns as native JS arrays, so the row is already in the shape the shared parser expects.
  return { kind: 'present', record: parseContractMarkerRow(row) };
}

export function createPostgresAdapter(options?: PostgresAdapterOptions) {
  return Object.freeze(new PostgresAdapterImpl(options));
}
