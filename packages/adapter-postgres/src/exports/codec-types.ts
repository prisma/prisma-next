/**
 * Codec type definitions for Postgres adapter.
 *
 * This file exports type-only definitions for codec input/output types.
 * These types are imported by contract.d.ts files for compile-time type inference.
 *
 * Runtime codec implementations are provided by the adapter's codec registry.
 */
export type CodecTypes = {
  readonly 'pg/text@1': { readonly input: string; readonly output: string };
  readonly 'pg/int4@1': { readonly input: number; readonly output: number };
  readonly 'pg/int2@1': { readonly input: number; readonly output: number };
  readonly 'pg/int8@1': { readonly input: number; readonly output: number };
  readonly 'pg/float4@1': { readonly input: number; readonly output: number };
  readonly 'pg/float8@1': { readonly input: number; readonly output: number };
  readonly 'pg/timestamp@1': { readonly input: string | Date; readonly output: string };
  readonly 'pg/timestamptz@1': { readonly input: string | Date; readonly output: string };
  readonly 'pg/bool@1': { readonly input: boolean; readonly output: boolean };
};

/**
 * Scalar to JavaScript type mapping for Postgres adapter.
 *
 * This type-only mapping defines how storage scalar types map to JavaScript types.
 * Used by contract.d.ts for compile-time type inference in query lanes.
 */
export type ScalarToJs = {
  readonly int4: number;
  readonly float8: number;
  readonly int2: number;
  readonly int8: number;
  readonly float4: number;
  readonly text: string;
  readonly timestamptz: string;
  readonly timestamp: string;
  readonly bool: boolean;
};
