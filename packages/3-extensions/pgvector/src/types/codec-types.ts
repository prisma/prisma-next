/**
 * Codec type definitions for pgvector extension.
 *
 * This file exports type-only definitions for codec input/output types.
 * These types are imported by contract.d.ts files for compile-time type inference.
 *
 * Runtime codec implementations are provided by the extension's codec registry.
 */

import type { CodecTypes as CoreCodecTypes } from '../core/codecs';

/**
 * Type-level branded vector.
 *
 * The runtime values are plain number arrays, but parameterized column typing can
 * carry the dimension at the type level (e.g. Vector<1536>).
 */
export type Vector<N extends number = number> = number[] & { readonly __vectorLength?: N };

/**
 * Codec types for pgvector.
 *
 * - Scalar output remains `number[]` (runtime representation).
 * - `parameterizedOutput` enables lane typing to compute `Vector<N>` from column `typeParams`.
 */
export type CodecTypes = CoreCodecTypes & {
  readonly 'pg/vector@1': CoreCodecTypes['pg/vector@1'] & {
    readonly parameterizedOutput: <P extends { readonly length: number }>(
      params: P,
    ) => P extends { readonly length: infer N extends number } ? Vector<N> : Vector<number>;
  };
};
