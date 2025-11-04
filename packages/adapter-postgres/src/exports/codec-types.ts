/**
 * Codec type definitions for Postgres adapter.
 *
 * This file exports type-only definitions for codec input/output types.
 * These types are imported by contract.d.ts files for compile-time type inference.
 *
 * Runtime codec implementations are provided by the adapter's codec registry.
 */
export type CodecTypes = {
  readonly 'core/string@1': { readonly input: string; readonly output: string };
  readonly 'core/number@1': { readonly input: number; readonly output: number };
  readonly 'core/iso-datetime@1': { readonly input: string | Date; readonly output: string };
};
