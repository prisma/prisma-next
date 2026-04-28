import type { GeneratedValueSpec } from '@prisma-next/contract/types';
import type { Codec, Ctx } from '@prisma-next/framework-components/codec';
import type { RuntimeAdapterInstance } from '@prisma-next/framework-components/execution';
import { builtinGeneratorIds } from '@prisma-next/ids';
import { generateId } from '@prisma-next/ids/runtime';
import type { Adapter, AnyQueryAst, CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeAdapterDescriptor,
} from '@prisma-next/sql-runtime';
import { type as arktype } from 'arktype';
import { createPostgresAdapter } from '../core/adapter';
import { PG_JSON_CODEC_ID, PG_JSONB_CODEC_ID } from '../core/codec-ids';
import { codecDefinitions } from '../core/codecs';
import { postgresAdapterDescriptorMeta, postgresQueryOperations } from '../core/descriptor-meta';
import {
  compileJsonSchemaValidator,
  type JsonSchemaValidateFn,
} from '../core/json-schema-validator';
import type { PostgresContract, PostgresLoweredStatement } from '../core/types';

/**
 * Codec instance returned by the JSON/JSONB factory. Carries the per-instance
 * compiled JSON-schema validator so `sql-runtime`'s validator registry can read
 * it directly off the resolved codec (replaces the pre-M1 `init` hook on the
 * descriptor; per spec § Decision and § Rejected alternatives, "the factory IS
 * what `init` was").
 */
type JsonCodecInstance = Codec & { readonly validate: JsonSchemaValidateFn };

export interface SqlRuntimeAdapter
  extends RuntimeAdapterInstance<'sql', 'postgres'>,
    Adapter<AnyQueryAst, PostgresContract, PostgresLoweredStatement> {}

function createPostgresCodecRegistry(): CodecRegistry {
  const registry = createCodecRegistry();
  for (const definition of Object.values(codecDefinitions)) {
    registry.register(definition.codec);
  }
  return registry;
}

const jsonTypeParamsSchema = arktype({
  schemaJson: 'object',
  'type?': 'string',
});

/** The inferred type params shape from the arktype schema. */
type JsonTypeParams = typeof jsonTypeParamsSchema.infer;

/**
 * Compiled JSON-schema validator carrier returned by the JSON/JSONB factory.
 *
 * Kept as a public alias for downstream consumers that previously imported the
 * `JsonCodecHelper` shape from this module. The shape is now part of the codec the
 * factory returns (`JsonCodecInstance`); this alias is a structural subset.
 */
export type JsonCodecHelper = { readonly validate: JsonSchemaValidateFn };

function createPostgresMutationDefaultGenerators() {
  return builtinGeneratorIds.map((id) => ({
    id,
    generate: (params?: Record<string, unknown>) => {
      const spec: GeneratedValueSpec = params ? { id, params } : { id };
      return generateId(spec);
    },
  }));
}

function buildJsonFactory(
  codecId: typeof PG_JSON_CODEC_ID | typeof PG_JSONB_CODEC_ID,
  nativeType: 'json' | 'jsonb',
): (params: JsonTypeParams) => (ctx: Ctx) => JsonCodecInstance {
  return (params) => {
    const validate = compileJsonSchemaValidator(params.schemaJson as Record<string, unknown>);
    return (_ctx) => ({
      id: codecId,
      targetTypes: [nativeType],
      decode: (wire: unknown) => wire,
      encodeJson: (value) => value as never,
      decodeJson: (json) => json as never,
      validate,
    });
  };
}

const pgJsonFactory = buildJsonFactory(PG_JSON_CODEC_ID, 'json');
const pgJsonbFactory = buildJsonFactory(PG_JSONB_CODEC_ID, 'jsonb');

const parameterizedCodecDescriptors = [
  {
    codecId: PG_JSON_CODEC_ID,
    paramsSchema: jsonTypeParamsSchema,
    factory: pgJsonFactory,
  },
  {
    codecId: PG_JSONB_CODEC_ID,
    paramsSchema: jsonTypeParamsSchema,
    factory: pgJsonbFactory,
  },
] as const satisfies ReadonlyArray<RuntimeParameterizedCodecDescriptor<JsonTypeParams>>;

const postgresRuntimeAdapterDescriptor: SqlRuntimeAdapterDescriptor<'postgres', SqlRuntimeAdapter> =
  {
    ...postgresAdapterDescriptorMeta,
    codecs: createPostgresCodecRegistry,
    parameterizedCodecs: () => parameterizedCodecDescriptors,
    queryOperations: () => postgresQueryOperations(),
    mutationDefaultGenerators: createPostgresMutationDefaultGenerators,
    create(): SqlRuntimeAdapter {
      return createPostgresAdapter();
    },
  };

export default postgresRuntimeAdapterDescriptor;
