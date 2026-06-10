import type { CodecLookup } from '@prisma-next/framework-components/codec';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import type {
  Adapter,
  AdapterProfile,
  AnyQueryAst,
  LowererContext,
  RawSqlLiteral,
  SqlQueryable,
} from '@prisma-next/sql-relational-core/ast';
import { isDdlNode } from '@prisma-next/sql-relational-core/ast';
import type { RawCodecInferer } from '@prisma-next/sql-relational-core/expression';
import type { PostgresDdlNode } from '@prisma-next/target-postgres/ddl';
import { createPostgresBuiltinCodecLookup } from './codec-lookup';
import { PostgresControlAdapter } from './control-adapter';
import { renderLoweredSql } from './sql-renderer';
import type { PostgresAdapterOptions, PostgresContract, PostgresLoweredStatement } from './types';

const defaultCapabilities = Object.freeze({
  postgres: {
    orderBy: true,
    limit: true,
    lateral: true,
    jsonAgg: true,
    returning: true,
    distinctOn: true,
  },
  sql: {
    enums: true,
    returning: true,
    defaultInInsert: true,
    lateral: true,
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
    const controlAdapter = new PostgresControlAdapter(this.codecLookup);
    this.profile = Object.freeze({
      id: options?.profileId ?? 'postgres/default@1',
      target: 'postgres',
      capabilities: defaultCapabilities,
      readMarker: (queryable: SqlQueryable) =>
        controlAdapter.readMarkerDiscriminated(
          {
            familyId: 'sql',
            targetId: 'postgres',
            query: async <Row = Record<string, unknown>>(
              sql: string,
              params?: readonly unknown[],
            ) => {
              const result = await queryable.query<Row>(sql, params);
              return { rows: [...result.rows] };
            },
            close: async () => {},
          },
          APP_SPACE_ID,
        ),
    });
  }

  lower(
    ast: AnyQueryAst | PostgresDdlNode,
    context: LowererContext<PostgresContract>,
  ): PostgresLoweredStatement {
    if (isDdlNode(ast)) {
      throw new Error(
        'lower() cannot lower DDL: DDL default literals require inline codec encoding, which is async. Use lowerToExecutableStatement().',
      );
    }
    return renderLoweredSql(ast, context.contract, this.codecLookup);
  }
}

/** Codec-id lookup for bare-literal interpolations used by `fns.raw` on a postgres client. Contributed as the descriptor's static `rawCodecInferer` slot. */
export const postgresRawCodecInferer: RawCodecInferer = {
  inferCodec(value: RawSqlLiteral): string {
    switch (typeof value) {
      case 'number':
        return Number.isSafeInteger(value) && value % 1 === 0 ? 'pg/int4' : 'pg/float8';
      case 'bigint':
        return 'pg/int8';
      case 'string':
        return 'pg/text';
      case 'boolean':
        return 'pg/bool';
      case 'object':
        if (value instanceof Uint8Array) return 'pg/bytea';
    }
    throw new Error(
      'unsupported JS value type for raw-SQL interpolation: wrap this value in `param(...)` with an explicit codec',
    );
  },
};

export function createPostgresAdapter(options?: PostgresAdapterOptions) {
  return Object.freeze(new PostgresAdapterImpl(options));
}
