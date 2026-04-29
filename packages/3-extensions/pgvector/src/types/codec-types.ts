/**
 * Codec type definitions for pgvector extension.
 *
 * Type-only export consumed by emitted `contract.d.ts` to power
 * `CodecTypes['pg/vector@1']['output']` lookups. The shape mirrors the codec
 * the curried factory returns at runtime so the emit and no-emit paths stay
 * structurally aligned. See [ADR 205](../../../../../docs/architecture%20docs/adrs/ADR%20205%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).
 */

/**
 * Type-level branded vector.
 *
 * The runtime values are plain number arrays, but parameterized column typing
 * can carry the dimension at the type level (e.g. Vector<1536>).
 */
export type Vector<N extends number = number> = number[] & { readonly __vectorLength?: N };

/**
 * The pgvector codec type map. Public API consumed by emitted `contract.d.ts`
 * via `CodecTypes['pg/vector@1']['output']`. Authored as a direct type literal
 * (rather than derived from a `defineCodecs(...)` builder) now that the codec
 * is consolidated into a single source-of-truth module.
 */
export type CodecTypes = {
  readonly 'pg/vector@1': {
    readonly input: number[];
    readonly output: number[];
    readonly traits: 'equality';
  };
};
