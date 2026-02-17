import type { RuntimeAdapterInstance } from '@prisma-next/core-execution-plane/types';
import type { Adapter, CodecRegistry, QueryAst } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeAdapterDescriptor,
} from '@prisma-next/sql-runtime';
import { type as arktype } from 'arktype';
import { createPostgresAdapter } from '../core/adapter';
import { PG_JSON_CODEC_ID, PG_JSONB_CODEC_ID } from '../core/codec-ids';
import { codecDefinitions } from '../core/codecs';
import { postgresAdapterDescriptorMeta } from '../core/descriptor-meta';
import { compileJsonSchemaValidator, type JsonSchemaValidateFn } from '../core/json-schema-validator';
import type { PostgresContract, PostgresLoweredStatement } from '../core/types';

export interface SqlRuntimeAdapter
  extends RuntimeAdapterInstance<'sql', 'postgres'>,
    Adapter<QueryAst, PostgresContract, PostgresLoweredStatement> {}

function createPostgresCodecRegistry(): CodecRegistry {
  const registry = createCodecRegistry();
  for (const definition of Object.values(codecDefinitions)) {
    registry.register(definition.codec);
  }
  return registry;
}

const jsonTypeParamsSchema = arktype({
  schema: 'object',
  'type?': 'string',
});

type JsonTypeParams = { readonly schema: Record<string, unknown>; readonly type?: string };

/**
 * Helper returned by the JSON/JSONB `init` hook.
 * Contains a compiled JSON Schema validate function for runtime conformance checks.
 */
export type JsonCodecHelper = { readonly validate: JsonSchemaValidateFn };

function initJsonCodecHelper(params: JsonTypeParams): JsonCodecHelper {
  return { validate: compileJsonSchemaValidator(params.schema) };
}

const parameterizedCodecDescriptors = [
  {
    codecId: PG_JSON_CODEC_ID,
    paramsSchema: jsonTypeParamsSchema,
    init: initJsonCodecHelper,
  },
  {
    codecId: PG_JSONB_CODEC_ID,
    paramsSchema: jsonTypeParamsSchema,
    init: initJsonCodecHelper,
  },
] as const satisfies ReadonlyArray<
  RuntimeParameterizedCodecDescriptor<JsonTypeParams, JsonCodecHelper>
>;

const postgresRuntimeAdapterDescriptor: SqlRuntimeAdapterDescriptor<'postgres', SqlRuntimeAdapter> =
  {
    ...postgresAdapterDescriptorMeta,
    codecs: createPostgresCodecRegistry,
    operationSignatures: () => [],
    parameterizedCodecs: () => parameterizedCodecDescriptors,
    create(): SqlRuntimeAdapter {
      return createPostgresAdapter();
    },
  };

export default postgresRuntimeAdapterDescriptor;
