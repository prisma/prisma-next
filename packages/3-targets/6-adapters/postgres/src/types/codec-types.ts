/**
 * Extended codec type definitions for Postgres adapter.
 *
 * This file exports type-only definitions for codec input/output types,
 * including parameterized output types for enums.
 *
 * Runtime codec implementations are provided by the adapter's codec registry.
 */

import type { CodecTypes as CoreCodecTypes } from '../core/codecs';

/**
 * Helper type that converts a readonly array of string literals to a union type.
 * e.g., readonly ['USER', 'ADMIN'] -> 'USER' | 'ADMIN'
 */
type ArrayToUnion<T extends readonly string[]> = T[number];

/**
 * Codec types for Postgres adapter with parameterized enum support.
 *
 * - Base scalar types use their standard output types.
 * - `pg/enum@1` uses `parameterizedOutput` to compute the union type from `typeParams.values`.
 */
export type CodecTypes = CoreCodecTypes & {
  readonly 'pg/enum@1': CoreCodecTypes['pg/enum@1'] & {
    /**
     * Computes the enum union type from typeParams.values.
     * e.g., { values: readonly ['USER', 'ADMIN'] } -> 'USER' | 'ADMIN'
     */
    readonly parameterizedOutput: <P extends { readonly values: readonly string[] }>(
      params: P,
    ) => P extends { readonly values: infer V extends readonly string[] }
      ? ArrayToUnion<V>
      : string;
  };
};
