/**
 * Column type descriptors for pgvector extension.
 *
 * Pack-author surface: users write `vector(1536)` at a column site. The factory
 * returns a `ColumnTypeDescriptor` that carries both the data part (`codecId`,
 * `nativeType`, `typeParams`) AND a curried higher-order codec factory in the
 * `type` slot so the no-emit `FieldOutputType` resolver can derive the
 * column's resolved JS type as `Vector<N>` (parameterized by the literal `N`).
 *
 * The `type` factory and the framework-registration `pgVectorCodec`
 * descriptor (in `./codecs`) share the same per-instance codec via
 * `vectorCodecForLength(length)`; the runtime `factory(params)(ctx)` and the
 * authoring `descriptor.type(ctx)` produce structurally equivalent codecs.
 * See [ADR 205](../../../../../docs/architecture%20docs/adrs/ADR%20205%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).
 */

import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import type { Ctx } from '@prisma-next/framework-components/codec';
import { VECTOR_CODEC_ID, VECTOR_MAX_DIM } from '../core/constants';
import { type VectorCodec, vectorCodecForLength } from '../core/vector-factory';

/**
 * Static vector column descriptor without dimension. Carried for back-compat
 * with consumers that don't need a typed length; users that want the typed
 * `Vector<N>` resolution should use `vector(N)`.
 */
export const vectorColumn = {
  codecId: VECTOR_CODEC_ID,
  nativeType: 'vector',
} as const satisfies ColumnTypeDescriptor;

/**
 * Curried higher-order codec factory for dimensioned vectors. Same call site as
 * pre-M4 (`vector(1536)`); the return type now carries the higher-order codec
 * factory in `type` so the no-emit `FieldOutputType` resolver picks up the
 * resolved JS type as `Vector<N>`.
 *
 * @param length - The dimension of the vector (e.g., 1536 for OpenAI embeddings)
 * @returns A column type descriptor with `typeParams.length` set and a `type`
 *          factory keyed by `length`
 * @throws {RangeError} If length is not an integer in the range [1, VECTOR_MAX_DIM]
 */
export function vector<N extends number>(
  length: N,
): ColumnTypeDescriptor & {
  readonly codecId: typeof VECTOR_CODEC_ID;
  readonly nativeType: 'vector';
  readonly typeParams: { readonly length: N };
  readonly type: (ctx: Ctx) => VectorCodec<N>;
} {
  if (!Number.isInteger(length) || length < 1 || length > VECTOR_MAX_DIM) {
    throw new RangeError(
      `pgvector: dimension must be an integer in [1, ${VECTOR_MAX_DIM}], got ${length}`,
    );
  }
  return {
    codecId: VECTOR_CODEC_ID,
    nativeType: 'vector',
    typeParams: { length },
    type: vectorCodecForLength(length),
  } as const;
}
