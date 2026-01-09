/**
 * Column type descriptors for pgvector extension.
 *
 * These descriptors provide both codecId and nativeType for use in contract authoring.
 * They are derived from the same source of truth as codec definitions and manifests.
 */

import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import { VECTOR_MAX_DIM } from '../core/constants';

/**
 * Static vector column descriptor without dimension.
 * Use `vector(N)` for dimensioned vectors that produce `vector(N)` DDL.
 */
export const vectorColumn = {
  codecId: 'pg/vector@1',
  nativeType: 'vector',
} as const satisfies ColumnTypeDescriptor;

/**
 * Factory for creating dimensioned vector column descriptors.
 *
 * @example
 * ```typescript
 * .column('embedding', { type: vector(1536), nullable: false })
 * // Produces: nativeType: 'vector(1536)', typeParams: { length: 1536 }
 * ```
 *
 * @param length - The dimension of the vector (e.g., 1536 for OpenAI embeddings)
 * @returns A column type descriptor with `typeParams.length` set
 * @throws {RangeError} If length is not an integer in the range [1, VECTOR_MAX_DIM]
 */
export function vector<N extends number>(
  length: N,
): ColumnTypeDescriptor & { readonly typeParams: { readonly length: N } } {
  if (!Number.isInteger(length) || length < 1 || length > VECTOR_MAX_DIM) {
    throw new RangeError(
      `pgvector: dimension must be an integer in [1, ${VECTOR_MAX_DIM}], got ${length}`,
    );
  }
  return {
    codecId: 'pg/vector@1',
    nativeType: `vector(${length})`,
    typeParams: { length },
  } as const;
}
