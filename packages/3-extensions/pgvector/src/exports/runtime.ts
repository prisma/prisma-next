import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeExtensionDescriptor,
  SqlRuntimeExtensionInstance,
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

/**
 * Pre-allocated parameterized codec descriptors to avoid per-call allocations.
 */
const parameterizedCodecDescriptors = [
  {
    codecId: VECTOR_CODEC_ID,
    paramsSchema: vectorParamsSchema,
  },
] as const satisfies ReadonlyArray<
  RuntimeParameterizedCodecDescriptor<{ readonly length: number }>
>;

/**
 * Creates the codec registry from codec definitions.
 * Used for static contributions on the descriptor.
 */
function createPgvectorCodecRegistry(): CodecRegistry {
  const registry = createCodecRegistry();
  for (const def of Object.values(codecDefinitions)) {
    registry.register(def.codec);
  }
  return registry;
}

/**
 * pgvector SQL runtime extension descriptor.
 * Implements SqlRuntimeExtensionDescriptor with required static contributions.
 *
 * The extension contributes:
 * - codecs: pg/vector@1 codec for vector type
 * - operations: l2Distance operation for vector similarity search
 * - parameterizedCodecs: vector params schema for length validation
 *
 * The instance is minimal (identity only) - all contributions are on the descriptor.
 */
const pgvectorRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: pgvectorPackMeta.id,
  version: pgvectorPackMeta.version,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  codecs: createPgvectorCodecRegistry,
  operationSignatures: () => [pgvectorOperationSignature],
  parameterizedCodecs: () => parameterizedCodecDescriptors,
  create(): SqlRuntimeExtensionInstance<'postgres'> {
    return {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
    };
  },
};

export default pgvectorRuntimeDescriptor;
