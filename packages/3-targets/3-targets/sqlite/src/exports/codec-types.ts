/**
 * Codec type definitions for the SQLite target.
 *
 * Defining `CodecTypes` here (rather than re-exporting from
 * `core/codecs-class`) keeps the tsdown DTS bundler from emitting
 * a private chunk path in downstream `.d.mts` files: consumers see
 * `CodecTypes` resolved via this public entry point rather than via
 * a hash-named internal chunk (TML-2357 M0 R6 / F8).
 */

import type { ExtractCodecTypes } from '@prisma-next/sql-relational-core/ast';
import {
  sqlCharDescriptorClass,
  sqlFloatDescriptorClass,
  sqlIntDescriptorClass,
  sqlVarcharDescriptorClass,
} from '@prisma-next/sql-relational-core/ast';
import type { JsonValue } from '../core/codecs';
import {
  sqliteBigintDescriptorClass,
  sqliteBlobDescriptorClass,
  sqliteDatetimeDescriptorClass,
  sqliteIntegerDescriptorClass,
  sqliteJsonDescriptorClass,
  sqliteRealDescriptorClass,
  sqliteTextDescriptorClass,
} from '../core/codecs-class';

const codecDescriptorMap = {
  char: sqlCharDescriptorClass,
  varchar: sqlVarcharDescriptorClass,
  int: sqlIntDescriptorClass,
  float: sqlFloatDescriptorClass,
  text: sqliteTextDescriptorClass,
  integer: sqliteIntegerDescriptorClass,
  real: sqliteRealDescriptorClass,
  blob: sqliteBlobDescriptorClass,
  datetime: sqliteDatetimeDescriptorClass,
  json: sqliteJsonDescriptorClass,
  bigint: sqliteBigintDescriptorClass,
} as const;

type Resolve<T> = { readonly [K in keyof T]: { readonly [P in keyof T[K]]: T[K][P] } };

export type CodecTypes = Resolve<ExtractCodecTypes<typeof codecDescriptorMap>>;

export type { JsonValue };
