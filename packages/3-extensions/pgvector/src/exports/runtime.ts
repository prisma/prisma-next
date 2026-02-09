import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeExtensionDescriptor,
} from '@prisma-next/sql-runtime';
import { type as arktype } from 'arktype';
import { codecDefinitions } from '../core/codecs';
import { VECTOR_CODEC_ID, VECTOR_MAX_DIM } from '../core/constants';
import { pgvectorOperationSignature, pgvectorPackMeta } from '../core/descriptor-meta';

const vectorParamsSchema = arktype({
  length: 'number',
}).narrow((params, ctx) => {
  const { length } = params;
  if (!Number.isInteger(length)) {
    return ctx.mustBe('an integer');
  }
  if (length < 1 || length > VECTOR_MAX_DIM) {
    return ctx.mustBe(`in the range [1, ${VECTOR_MAX_DIM}]`);
  }
  return true;
});

const parameterizedCodecDescriptors = [
  {
    codecId: VECTOR_CODEC_ID,
    paramsSchema: vectorParamsSchema,
  },
] as const satisfies ReadonlyArray<
  RuntimeParameterizedCodecDescriptor<{ readonly length: number }>
>;

function createPgvectorCodecRegistry() {
  const registry = createCodecRegistry();
  for (const def of Object.values(codecDefinitions)) {
    registry.register(def.codec);
  }
  return registry;
}

const pgvectorRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: pgvectorPackMeta.id,
  version: pgvectorPackMeta.version,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  codecs: createPgvectorCodecRegistry,
  operationSignatures: () => [pgvectorOperationSignature],
  parameterizedCodecs: () => parameterizedCodecDescriptors,
  create() {
    return {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
    };
  },
};

export default pgvectorRuntimeDescriptor;
