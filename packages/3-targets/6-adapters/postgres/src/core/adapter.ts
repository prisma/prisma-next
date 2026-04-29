import type { CodecLookup } from '@prisma-next/framework-components/codec';
import {
  type Adapter,
  type AdapterProfile,
  type AnyQueryAst,
  type CodecParamsDescriptor,
  createCodecRegistry,
  type LowererContext,
} from '@prisma-next/sql-relational-core/ast';
import { parseContractMarkerRow } from '@prisma-next/sql-runtime';
import { codecDefinitions } from '@prisma-next/target-postgres/codecs';
import { ifDefined } from '@prisma-next/utils/defined';
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

type AdapterCodec = (typeof codecDefinitions)[keyof typeof codecDefinitions]['codec'];
type ParameterizedCodec = AdapterCodec & {
  readonly paramsSchema: NonNullable<AdapterCodec['paramsSchema']>;
};

const parameterizedCodecs: ReadonlyArray<CodecParamsDescriptor> = Object.values(codecDefinitions)
  .map((definition) => definition.codec)
  .filter((codec): codec is ParameterizedCodec => codec.paramsSchema !== undefined)
  .map((codec) =>
    Object.freeze({
      codecId: codec.id,
      paramsSchema: codec.paramsSchema,
      ...ifDefined('init', codec.init),
    }),
  );

class PostgresAdapterImpl
  implements Adapter<AnyQueryAst, PostgresContract, PostgresLoweredStatement>
{
  // These fields make the adapter instance structurally compatible with
  // RuntimeAdapterInstance<'sql', 'postgres'> without introducing a runtime-plane dependency.
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;

  readonly profile: AdapterProfile<'postgres'>;
  private readonly codecRegistry = (() => {
    const registry = createCodecRegistry();
    for (const definition of Object.values(codecDefinitions)) {
      registry.register(definition.codec);
    }
    return registry;
  })();
  private readonly codecLookup: CodecLookup;

  constructor(options?: PostgresAdapterOptions) {
    this.codecLookup = options?.codecLookup ?? createPostgresBuiltinCodecLookup();
    this.profile = Object.freeze({
      id: options?.profileId ?? 'postgres/default@1',
      target: 'postgres',
      capabilities: defaultCapabilities,
      codecs: () => this.codecRegistry,
      readMarkerStatement: () => ({
        sql: 'select core_hash, profile_hash, contract_json, canonical_version, updated_at, app_tag, meta, invariants from prisma_contract.marker where id = $1',
        params: [1],
      }),
      // Postgres' driver hydrates `text[]` columns as native JS arrays, so
      // the row is already in the shape the shared parser expects.
      parseMarkerRow: (row: unknown) => parseContractMarkerRow(row),
    });
  }

  parameterizedCodecs(): ReadonlyArray<CodecParamsDescriptor> {
    return parameterizedCodecs;
  }

  lower(ast: AnyQueryAst, context: LowererContext<PostgresContract>): PostgresLoweredStatement {
    return renderLoweredSql(ast, context.contract, this.codecLookup);
  }
}

export function createPostgresAdapter(options?: PostgresAdapterOptions) {
  return Object.freeze(new PostgresAdapterImpl(options));
}
