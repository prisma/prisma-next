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

// pgvector is stateless at the per-instance level (no key derivation, no
// compiled-on-load helper) — `length` is metadata only. The factory therefore
// simply returns the static `pg/vector@1` codec for any params/ctx; M4
// ([TML-2330]) will replace this with a typed curried factory whose return type
// carries `Vector<N>` to drive the no-emit FieldOutputType resolver.
function vectorFactory(_params: { readonly length: number }): (ctx: Ctx) => Codec {
  const baseCodec = codecDefinitions.vector.codec;
  return (_ctx) => baseCodec;
}

const parameterizedCodecDescriptors = [
  {
    codecId: VECTOR_CODEC_ID,
    paramsSchema: vectorParamsSchema,
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
