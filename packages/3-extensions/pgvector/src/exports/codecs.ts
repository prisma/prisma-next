/**
 * Framework-registration descriptor for the pgvector codec.
 *
 * The runtime descriptor at `./runtime.ts` registers `pgVectorCodec` with the
 * SQL runtime via the `parameterizedCodecs` slot; `sql-runtime`'s
 * `initializeTypeHelpers` calls `pgVectorCodec.factory(typeParams)(ctx)` once
 * per `storage.types` instance keyed by `pg/vector@1` to materialize the
 * resolved codec for that instance. See [ADR 205](../../../../../docs/architecture%20docs/adrs/ADR%20205%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).
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
