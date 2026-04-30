import type { Codec, Ctx } from '@prisma-next/framework-components/codec';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeExtensionDescriptor,
} from '@prisma-next/sql-runtime';
import { type as arktype } from 'arktype';
import { codecDefinitions } from '../core/codecs';
import { VECTOR_CODEC_ID, VECTOR_MAX_DIM } from '../core/constants';
import { pgvectorPackMeta, pgvectorQueryOperations } from '../core/descriptor-meta';

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

// pgvector's encode is parameter-independent (the wire format `[v1,v2,...]`
// doesn't care about declared length), so the resolved codec for every
// `(length)` instance is the same shared codec object today. The factory
// returns it directly; `Ctx` is unused. When a future refactor wants per-
// instance state (e.g. capping wire length to declared dimension), the
// closure over `params` is the place to add it.
const sharedVectorCodec: Codec = codecDefinitions.vector.codec;
const vectorFactory = (_params: { readonly length: number }) => (_ctx: Ctx) => sharedVectorCodec;

const parameterizedCodecDescriptors = [
  {
    codecId: VECTOR_CODEC_ID,
    traits: ['equality'] as const,
    targetTypes: ['vector'] as const,
    paramsSchema: vectorParamsSchema,
    renderOutputType: (params: { readonly length: number }) => `Vector<${params.length}>`,
    factory: vectorFactory,
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
  // Mirror `pgvectorPackMeta.types.codecTypes.codecInstances` here so that
  // runtime-plane assemblers driven by `extractCodecLookup` (which reads
  // `descriptor.types?.codecTypes?.codecInstances`) discover `pg/vector@1`.
  // Without this, the Postgres adapter's runtime-plane codec lookup misses
  // the vector codec and `$N::vector` would silently disappear once the
  // renderer switches to lookup-driven cast policy.
  types: {
    codecTypes: {
      codecInstances: Object.values(codecDefinitions).map((def) => def.codec),
    },
  },
  codecs: createPgvectorCodecRegistry,
  queryOperations: () => pgvectorQueryOperations(),
  parameterizedCodecs: () => parameterizedCodecDescriptors,
  create() {
    return {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
    };
  },
};

export default pgvectorRuntimeDescriptor;
