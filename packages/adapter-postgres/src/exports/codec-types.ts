/**
 * Codec type definitions for Postgres adapter.
 *
 * This file exports type-only definitions for codec input/output types.
 * These types are imported by contract.d.ts files for compile-time type inference.
 *
 * Runtime codec implementations are provided by the adapter's codec registry.
 */

// Define data type constants with literal types preserved
export const dataTypes = {
  text: 'pg/text@1',
  int4: 'pg/int4@1',
  int2: 'pg/int2@1',
  int8: 'pg/int8@1',
  float4: 'pg/float4@1',
  float8: 'pg/float8@1',
  timestamp: 'pg/timestamp@1',
  timestamptz: 'pg/timestamptz@1',
  bool: 'pg/bool@1',
} as const;

// Type helper to extract values from dataTypes
type ValuesOf<T> = T[keyof T];

// CodecTypes must include all type IDs from dataTypes values
// This constraint ensures CodecTypes has all keys from dataTypes values
type _CodecTypesConstraint = Record<
  ValuesOf<typeof dataTypes>,
  { readonly input: unknown; readonly output: unknown }
>;

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
} & _CodecTypesConstraint;

/**
 * Scalar to JavaScript type mapping for Postgres adapter.
 *
 * This type-only mapping defines how storage scalar types map to JavaScript types.
 * Used by contract.d.ts for compile-time type inference in query lanes.
 */
// ScalarToJs must include all keys from dataTypes
// This constraint ensures ScalarToJs has all keys from dataTypes
type _ScalarToJsConstraint = Record<keyof typeof dataTypes, unknown>;

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
} & _ScalarToJsConstraint;
