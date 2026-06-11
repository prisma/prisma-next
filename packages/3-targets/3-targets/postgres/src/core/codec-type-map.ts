/**
 * Internal codec descriptor map and `CodecTypes` materialisation for the Postgres target.
 *
 * Why this lives in `core/` even though the public origin of `CodecTypes` is `exports/codec-types.ts`:
 *
 * - The descriptor map (`codecDescriptorMap`) and the `Resolve<T>` helper are implementation detail; they shouldn't appear on the public package surface.
 * - The `CodecTypes` *materialisation* (the `Resolve<...>` application) must still happen at the public boundary so tsdown's DTS bundler resolves consumer-side `pack.d.mts` references via the public entry point rather than a hash-named internal chunk (the `TS2742` family). `exports/codec-types.ts` re-exports `CodecTypes` from here as a type alias, which preserves the materialisation site at the public surface.
 */

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
  pgUuidDescriptor,
  pgVarbitDescriptor,
  pgVarcharDescriptor,
} from './codecs';

export const codecDescriptorMap = {
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
  uuid: pgUuidDescriptor,
  interval: pgIntervalDescriptor,
  enum: pgEnumDescriptor,
  json: pgJsonDescriptor,
  jsonb: pgJsonbDescriptor,
} as const;

export type Resolve<T> = { readonly [K in keyof T]: { readonly [P in keyof T[K]]: T[K][P] } };

export type CodecDescriptorMap = typeof codecDescriptorMap;

export type ExtractedCodecTypes = ExtractCodecTypes<CodecDescriptorMap>;
