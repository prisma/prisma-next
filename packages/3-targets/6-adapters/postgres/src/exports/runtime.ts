import type { GeneratedValueSpec } from '@prisma-next/contract/types';
import type { RuntimeAdapterInstance } from '@prisma-next/core-execution-plane/types';
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
import { postgresAdapterDescriptorMeta } from '../core/descriptor-meta';
import {
  compileJsonSchemaValidator,
  type JsonSchemaValidateFn,
} from '../core/json-schema-validator';
import type { PostgresContract, PostgresLoweredStatement } from '../core/types';

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
 * Helper returned by the JSON/JSONB `init` hook.
 * Contains a compiled JSON Schema validate function for runtime conformance checks.
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

function initJsonCodecHelper(params: JsonTypeParams): JsonCodecHelper {
  return { validate: compileJsonSchemaValidator(params.schemaJson as Record<string, unknown>) };
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
    mutationDefaultGenerators: createPostgresMutationDefaultGenerators,
    create(): SqlRuntimeAdapter {
      return createPostgresAdapter();
    },
  };

export default postgresRuntimeAdapterDescriptor;
