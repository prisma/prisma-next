import type { CodecLookup } from '@prisma-next/framework-components/codec';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import type {
  Adapter,
  AdapterProfile,
  AnyQueryAst,
  LowererContext,
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
      markerExistsStatement: () => ({
        sql: 'select 1 from information_schema.tables where table_schema = $1 and table_name = $2',
        params: ['prisma_contract', 'marker'],
      }),
      readMarkerStatement: () => ({
        sql: 'select core_hash, profile_hash, contract_json, canonical_version, updated_at, app_tag, meta, invariants from prisma_contract.marker where space = $1',
        params: [APP_SPACE_ID],
      }),
      // Postgres' driver hydrates `text[]` columns as native JS arrays, so the row is already in the shape the shared parser expects.
      parseMarkerRow: (row: unknown) => parseContractMarkerRow(row),
    });
  }

  lower(ast: AnyQueryAst, context: LowererContext<PostgresContract>): PostgresLoweredStatement {
    return renderLoweredSql(ast, context.contract, this.codecLookup);
  }
}

export function createPostgresAdapter(options?: PostgresAdapterOptions) {
  return Object.freeze(new PostgresAdapterImpl(options));
}
