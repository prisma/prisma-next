/**
 * Codec type definitions for the Postgres target.
 *
 * This file is the public origin of `CodecTypes`. Defining it here
 * (rather than re-exporting from `core/codecs`) keeps the
 * tsdown DTS bundler from emitting a private chunk path in
 * downstream `.d.mts` files: consumers see `CodecTypes` resolved via
 * this public entry point rather than via a hash-named internal
 * chunk (TML-2357).
 *
 * Lives in `target-postgres` because codec types describe the target's
 * value space - both the control adapter (introspection / schema
 * verification) and the runtime adapter (encode/decode) share the same
 * definitions, and the target package is the natural home that both
 * adapters depend on.
 */

import type { JsonValue } from '@prisma-next/contract/types';
import type { ExtractCodecTypes } from '@prisma-next/sql-relational-core/ast';
import {
  sqlCharDescriptor,
  sqlFloatDescriptor,
  sqlIntDescriptor,
  sqlTextDescriptor,
  sqlTimestampDescriptor,
  sqlVarcharDescriptor,
} from '@prisma-next/sql-relational-core/ast';
import {
  pgBitDescriptor,
  pgBoolDescriptor,
  pgByteaDescriptor,
  pgCharDescriptor,
  pgEnumDescriptor,
  pgFloat4Descriptor,
  pgFloat8Descriptor,
  pgFloatDescriptor,
  pgInt2Descriptor,
  pgInt4Descriptor,
  pgInt8Descriptor,
  pgIntDescriptor,
  pgIntervalDescriptor,
  pgJsonbDescriptor,
  pgJsonDescriptor,
  pgNumericDescriptor,
  pgTextDescriptor,
  pgTimeDescriptor,
  pgTimestampDescriptor,
  pgTimestamptzDescriptor,
  pgTimetzDescriptor,
  pgVarbitDescriptor,
  pgVarcharDescriptor,
} from '../core/codecs';

const codecDescriptorMap = {
  char: sqlCharDescriptor,
  varchar: sqlVarcharDescriptor,
  int: sqlIntDescriptor,
  float: sqlFloatDescriptor,
  'sql-text': sqlTextDescriptor,
  'sql-timestamp': sqlTimestampDescriptor,
  text: pgTextDescriptor,
  character: pgCharDescriptor,
  'character varying': pgVarcharDescriptor,
  integer: pgIntDescriptor,
  'double precision': pgFloatDescriptor,
  int4: pgInt4Descriptor,
  int2: pgInt2Descriptor,
  int8: pgInt8Descriptor,
  float4: pgFloat4Descriptor,
  float8: pgFloat8Descriptor,
  numeric: pgNumericDescriptor,
  timestamp: pgTimestampDescriptor,
  timestamptz: pgTimestamptzDescriptor,
  time: pgTimeDescriptor,
  timetz: pgTimetzDescriptor,
  bool: pgBoolDescriptor,
  bit: pgBitDescriptor,
  'bit varying': pgVarbitDescriptor,
  bytea: pgByteaDescriptor,
  interval: pgIntervalDescriptor,
  enum: pgEnumDescriptor,
  json: pgJsonDescriptor,
  jsonb: pgJsonbDescriptor,
} as const;

type Resolve<T> = { readonly [K in keyof T]: { readonly [P in keyof T[K]]: T[K][P] } };

export type CodecTypes = Resolve<ExtractCodecTypes<typeof codecDescriptorMap>>;

export type { JsonValue };

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
