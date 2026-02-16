import type { RuntimeAdapterInstance } from '@prisma-next/core-execution-plane/types';
import type { Adapter, CodecRegistry, QueryAst } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeAdapterDescriptor,
} from '@prisma-next/sql-runtime';
import { type as arktype } from 'arktype';
import { createPostgresAdapter } from '../core/adapter';
import { arrayParamsSchema } from '../core/array-codec';
import { PG_ARRAY_CODEC_ID, PG_JSON_CODEC_ID, PG_JSONB_CODEC_ID } from '../core/codec-ids';
import { codecDefinitions } from '../core/codecs';
import { postgresAdapterDescriptorMeta } from '../core/descriptor-meta';
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
  schemaJson: 'object',
  'type?': 'string',
});

const arrayCodecDescriptor: RuntimeParameterizedCodecDescriptor = {
  codecId: PG_ARRAY_CODEC_ID,
  paramsSchema: arrayParamsSchema,
};

const parameterizedCodecDescriptors = [
  {
    codecId: PG_JSON_CODEC_ID,
    paramsSchema: jsonTypeParamsSchema,
  },
  {
    codecId: PG_JSONB_CODEC_ID,
    paramsSchema: jsonTypeParamsSchema,
  },
  arrayCodecDescriptor,
] as const satisfies ReadonlyArray<RuntimeParameterizedCodecDescriptor>;

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
