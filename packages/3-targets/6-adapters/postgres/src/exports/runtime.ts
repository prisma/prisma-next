import type { GeneratedValueSpec } from '@prisma-next/contract/types';
import type { RuntimeAdapterInstance } from '@prisma-next/framework-components/execution';
import { builtinGeneratorIds } from '@prisma-next/ids';
import { generateId } from '@prisma-next/ids/runtime';
import type { Adapter, AnyQueryAst, CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeAdapterDescriptor,
} from '@prisma-next/sql-runtime';
import { PG_JSON_CODEC_ID, PG_JSONB_CODEC_ID } from '../core/codec-ids';
import { codecDefinitions } from '../core/codecs';
import { postgresAdapterDescriptorMeta, postgresQueryOperations } from '../core/descriptor-meta';
import {
  type JsonRuntimeParams,
  jsonRuntimeParamsSchema,
  pgJsonbRuntimeFactory,
  pgJsonRuntimeFactory,
} from '../codecs/json-runtime-factory';
import { createPostgresAdapter } from '../core/adapter';
import type { PostgresContract, PostgresLoweredStatement } from '../core/types';

export type { JsonCodecHelper } from '../codecs/json-runtime-factory';

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

function createPostgresMutationDefaultGenerators() {
  return builtinGeneratorIds.map((id) => ({
    id,
    generate: (params?: Record<string, unknown>) => {
      const spec: GeneratedValueSpec = params ? { id, params } : { id };
      return generateId(spec);
    },
  }));
}

const parameterizedCodecDescriptors = [
  {
    codecId: PG_JSON_CODEC_ID,
    paramsSchema: jsonRuntimeParamsSchema,
    factory: pgJsonRuntimeFactory,
  },
  {
    codecId: PG_JSONB_CODEC_ID,
    paramsSchema: jsonRuntimeParamsSchema,
    factory: pgJsonbRuntimeFactory,
  },
] as const satisfies ReadonlyArray<RuntimeParameterizedCodecDescriptor<JsonRuntimeParams>>;

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
