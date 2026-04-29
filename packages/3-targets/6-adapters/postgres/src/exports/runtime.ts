import type { GeneratedValueSpec } from '@prisma-next/contract/types';
import { extractCodecLookup } from '@prisma-next/framework-components/control';
import type { RuntimeAdapterInstance } from '@prisma-next/framework-components/execution';
import { builtinGeneratorIds } from '@prisma-next/ids';
import { generateId } from '@prisma-next/ids/runtime';
import type { Adapter, AnyQueryAst, CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeAdapterDescriptor,
} from '@prisma-next/sql-runtime';
import { PG_JSON_CODEC_ID, PG_JSONB_CODEC_ID } from '@prisma-next/target-postgres/codec-ids';
import { codecDefinitions } from '@prisma-next/target-postgres/codecs';
import { type as arktype } from 'arktype';
import { createPostgresAdapter } from '../core/adapter';
import { postgresAdapterDescriptorMeta, postgresQueryOperations } from '../core/descriptor-meta';
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
    parameterizedCodecs: () => parameterizedCodecDescriptors,
    queryOperations: () => postgresQueryOperations,
    mutationDefaultGenerators: createPostgresMutationDefaultGenerators,
    create(stack): SqlRuntimeAdapter {
      // The runtime `ExecutionStack` does not (yet) carry a pre-assembled
      // `codecLookup` field the way the control `ControlStack` does, so we
      // derive an equivalent lookup here from the stack's component metadata
      // (target + adapter + extension packs) using the same assembly helper
      // that `createControlStack` uses. This keeps the renderer fed with the
      // same codec set on both planes — including extension-contributed
      // codecs like `pg/vector@1` from `@prisma-next/extension-pgvector`.
      const codecLookup = extractCodecLookup([
        stack.target,
        stack.adapter,
        ...stack.extensionPacks,
      ]);
      return createPostgresAdapter({ codecLookup });
    },
  };

export default postgresRuntimeAdapterDescriptor;
