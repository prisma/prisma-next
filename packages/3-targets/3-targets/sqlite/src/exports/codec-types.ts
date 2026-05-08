/**
 * Codec type definitions for the SQLite target.
 *
 * Defining `CodecTypes` here (rather than re-exporting from
 * `core/codecs-class`) keeps the tsdown DTS bundler from emitting
 * a private chunk path in downstream `.d.mts` files: consumers see
 * `CodecTypes` resolved via this public entry point rather than via
 * a hash-named internal chunk (TML-2357).
 */

import type { ExtractCodecTypes } from '@prisma-next/sql-relational-core/ast';
import {
  sqlCharDescriptor,
  sqlFloatDescriptor,
  sqlIntDescriptor,
  sqlVarcharDescriptor,
} from '@prisma-next/sql-relational-core/ast';
import type { JsonValue } from '../core/codecs';
import {
  sqliteBigintDescriptor,
  sqliteBlobDescriptor,
  sqliteDatetimeDescriptor,
  sqliteIntegerDescriptor,
  sqliteJsonDescriptor,
  sqliteRealDescriptor,
  sqliteTextDescriptor,
} from '../core/codecs-class';

const codecDescriptorMap = {
  char: sqlCharDescriptor,
  varchar: sqlVarcharDescriptor,
  int: sqlIntDescriptor,
  float: sqlFloatDescriptor,
  text: sqliteTextDescriptor,
  integer: sqliteIntegerDescriptor,
  real: sqliteRealDescriptor,
  blob: sqliteBlobDescriptor,
  datetime: sqliteDatetimeDescriptor,
  json: sqliteJsonDescriptor,
  bigint: sqliteBigintDescriptor,
} as const;

type Resolve<T> = { readonly [K in keyof T]: { readonly [P in keyof T[K]]: T[K][P] } };

export type CodecTypes = Resolve<ExtractCodecTypes<typeof codecDescriptorMap>>;

export type { JsonValue };
