/**
 * Framework-registration descriptor for the pgvector codec.
 *
 * The runtime descriptor at `./runtime.ts` registers `pgVectorCodec` with the
 * SQL runtime via the `parameterizedCodecs` slot; `sql-runtime`'s
 * `initializeTypeHelpers` calls `pgVectorCodec.factory(typeParams)(ctx)` once
 * per `storage.types` instance keyed by `pg/vector@1` to materialize the
 * resolved codec for that instance.
 *
 * Codec-model-unification project, M4 T1.
 */

import type { ParameterizedCodecDescriptor } from '@prisma-next/framework-components/codec';
import { type as arktype } from 'arktype';
import { VECTOR_MAX_DIM } from '../core/constants';
import { vectorCodecForLength } from '../core/vector-factory';

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

export const pgVectorCodec: ParameterizedCodecDescriptor<{ readonly length: number }> = {
  codecId: 'pg/vector@1',
  paramsSchema: vectorParamsSchema,
  renderOutputType: ({ length }) => `Vector<${length}>`,
  factory: ({ length }) => vectorCodecForLength(length),
};
