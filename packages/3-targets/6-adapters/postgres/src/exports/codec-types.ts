/**
 * Codec type definitions for Postgres adapter.
 *
 * This file exports type-only definitions for codec input/output types.
 * These types are imported by contract.d.ts files for compile-time type inference.
 *
 * Runtime codec implementations are provided by the adapter's codec registry.
 */

import type { CodecTypes as CoreCodecTypes, JsonValue } from '../core/codecs';

/**
 * Compile-time view of the Standard Schema protocol.
 * Reads `~standard.types.output` to resolve TypeScript output types for contract.d.ts.
 *
 * This differs from the runtime `StandardSchemaLike` in `standard-schema.ts`, which reads
 * `~standard.jsonSchema.output` for the serializable JSON Schema representation.
 * Both are needed: this one drives compile-time type narrowing, the other drives
 * build-time contract emission.
 */
type StandardSchemaLike = {
  readonly '~standard'?: {
    readonly types?: {
      readonly output?: unknown;
    };
  };
};

type ResolveStandardSchemaOutput<P> = P extends {
  readonly schema: {
    readonly '~standard': { readonly types?: { readonly output?: infer Output } };
  };
}
  ? Output extends undefined
    ? JsonValue
    : Output
  : JsonValue;

export type CodecTypes = CoreCodecTypes & {
  readonly 'pg/json@1': CoreCodecTypes['pg/json@1'] & {
    readonly parameterizedOutput: <P extends { readonly schema?: StandardSchemaLike }>(
      params: P,
    ) => ResolveStandardSchemaOutput<P>;
  };
  readonly 'pg/jsonb@1': CoreCodecTypes['pg/jsonb@1'] & {
    readonly parameterizedOutput: <P extends { readonly schema?: StandardSchemaLike }>(
      params: P,
    ) => ResolveStandardSchemaOutput<P>;
  };
};

export type { JsonValue };
export { dataTypes } from '../core/codecs';

type Branded<T, Shape extends Record<string, unknown>> = T & {
  readonly [K in keyof Shape]: Shape[K];
};

type BrandedString<Shape extends Record<string, unknown>> = Branded<string, Shape>;

export type Char<N extends number> = BrandedString<{ __charLength: N }>;
export type Varchar<N extends number> = BrandedString<{ __varcharLength: N }>;
export type Numeric<P extends number, S extends number | undefined = undefined> = BrandedString<{
  __numericPrecision: P;
  __numericScale: S;
}>;
export type Bit<N extends number> = BrandedString<{ __bitLength: N }>;
export type VarBit<N extends number> = BrandedString<{ __varbitLength: N }>;
export type Timestamp<P extends number | undefined = undefined> = BrandedString<{
  __timestampPrecision: P;
}>;
export type Timestamptz<P extends number | undefined = undefined> = BrandedString<{
  __timestamptzPrecision: P;
}>;
export type Time<P extends number | undefined = undefined> = BrandedString<{ __timePrecision: P }>;
export type Timetz<P extends number | undefined = undefined> = BrandedString<{
  __timetzPrecision: P;
}>;
export type Interval<P extends number | undefined = undefined> = BrandedString<{
  __intervalPrecision: P;
}>;
