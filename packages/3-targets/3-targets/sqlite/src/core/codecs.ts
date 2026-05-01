import { codec, defineCodecs, sqlCodecDefinitions } from '@prisma-next/sql-relational-core/ast';
import {
  SQLITE_BIGINT_CODEC_ID,
  SQLITE_BLOB_CODEC_ID,
  SQLITE_DATETIME_CODEC_ID,
  SQLITE_INTEGER_CODEC_ID,
  SQLITE_JSON_CODEC_ID,
  SQLITE_REAL_CODEC_ID,
  SQLITE_TEXT_CODEC_ID,
} from './codec-ids';

const sqlCharCodec = sqlCodecDefinitions.char.codec;
const sqlVarcharCodec = sqlCodecDefinitions.varchar.codec;
const sqlIntCodec = sqlCodecDefinitions.int.codec;
const sqlFloatCodec = sqlCodecDefinitions.float.codec;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

const sqliteTextCodec = codec({
  typeId: SQLITE_TEXT_CODEC_ID,
  targetTypes: ['text'],
  traits: ['equality', 'order', 'textual'],
  encode: (value: string): string => value,
  decode: (wire: string): string => wire,
});

const sqliteIntegerCodec = codec({
  typeId: SQLITE_INTEGER_CODEC_ID,
  targetTypes: ['integer'],
  traits: ['equality', 'order', 'numeric'],
  encode: (value: number): number => value,
  decode: (wire: number): number => wire,
});

const sqliteRealCodec = codec({
  typeId: SQLITE_REAL_CODEC_ID,
  targetTypes: ['real'],
  traits: ['equality', 'order', 'numeric'],
  encode: (value: number): number => value,
  decode: (wire: number): number => wire,
});

const sqliteBlobCodec = codec({
  typeId: SQLITE_BLOB_CODEC_ID,
  targetTypes: ['blob'],
  traits: ['equality'],
  encode: (value: Uint8Array): Uint8Array => value,
  decode: (wire: Uint8Array): Uint8Array => wire,
  encodeJson: (value: Uint8Array): string => Buffer.from(value).toString('base64'),
  decodeJson: (json: JsonValue): Uint8Array => {
    if (typeof json !== 'string') {
      throw new TypeError('sqlite/blob@1 contract value must be a base64 string');
    }
    return new Uint8Array(Buffer.from(json, 'base64'));
  },
});

const sqliteDatetimeCodec = codec({
  typeId: SQLITE_DATETIME_CODEC_ID,
  targetTypes: ['text'],
  traits: ['equality', 'order'],
  encode: (value: Date): string => value.toISOString(),
  decode: (wire: string): Date => new Date(wire),
  encodeJson: (value: Date): string => value.toISOString(),
  decodeJson: (json: JsonValue): Date => {
    if (typeof json !== 'string') {
      throw new TypeError('sqlite/datetime@1 contract value must be an ISO-8601 string');
    }
    return new Date(json);
  },
});

const sqliteJsonCodec = codec({
  typeId: SQLITE_JSON_CODEC_ID,
  targetTypes: ['text'],
  traits: ['equality'],
  encode: (value: JsonValue): string => JSON.stringify(value),
  decode: (wire: string | JsonValue): JsonValue =>
    typeof wire === 'string' ? (JSON.parse(wire) as JsonValue) : wire,
});

const sqliteBigintCodec = codec({
  typeId: SQLITE_BIGINT_CODEC_ID,
  targetTypes: ['integer'],
  traits: ['equality', 'order', 'numeric'],
  encode: (value: bigint): number | bigint => value,
  decode: (wire: number | bigint): bigint => BigInt(wire),
  encodeJson: (value: bigint): string => value.toString(),
  decodeJson: (json: JsonValue): bigint => {
    if (typeof json !== 'string' && typeof json !== 'number') {
      throw new TypeError('sqlite/bigint@1 contract value must be a string or number');
    }
    return BigInt(json);
  },
});

const codecs = defineCodecs()
  .add('char', sqlCharCodec)
  .add('varchar', sqlVarcharCodec)
  .add('int', sqlIntCodec)
  .add('float', sqlFloatCodec)
  .add('text', sqliteTextCodec)
  .add('integer', sqliteIntegerCodec)
  .add('real', sqliteRealCodec)
  .add('blob', sqliteBlobCodec)
  .add('datetime', sqliteDatetimeCodec)
  .add('json', sqliteJsonCodec)
  .add('bigint', sqliteBigintCodec);

export const codecDefinitions = codecs.codecDefinitions;
export const dataTypes = codecs.dataTypes;

export type CodecTypes = typeof codecs.CodecTypes;

// ---------------------------------------------------------------------------
// Native CodecDescriptor exports (TML-2357 T2.4). Each sqlite target codec
// gains a sibling `*Descriptor` authored via `codecDescriptor()`. The
// descriptor builder is exposed as `codecDescriptorDefinitions` /
// `codecDescriptorList`. The legacy codec exports above stay so the
// sqlite adapter and tests keep reading codec instances out of
// `codecDefinitions[k].codec` until the unified `codecs:` slot reshape
// (later in M2). Both shapes retire to descriptor-only in the M2 cleanup
// commit.
// ---------------------------------------------------------------------------

import {
  codecDescriptor,
  defineCodecDescriptors,
  sqlCharDescriptor,
  sqlFloatDescriptor,
  sqlIntDescriptor,
  sqlVarcharDescriptor,
} from '@prisma-next/sql-relational-core/ast';

const sqliteTextDescriptor = codecDescriptor<
  typeof SQLITE_TEXT_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
>({
  codecId: SQLITE_TEXT_CODEC_ID,
  targetTypes: ['text'],
  traits: ['equality', 'order', 'textual'],
  encode: (value) => value,
  decode: (wire) => wire,
});

const sqliteIntegerDescriptor = codecDescriptor<
  typeof SQLITE_INTEGER_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
>({
  codecId: SQLITE_INTEGER_CODEC_ID,
  targetTypes: ['integer'],
  traits: ['equality', 'order', 'numeric'],
  encode: (value) => value,
  decode: (wire) => wire,
});

const sqliteRealDescriptor = codecDescriptor<
  typeof SQLITE_REAL_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
>({
  codecId: SQLITE_REAL_CODEC_ID,
  targetTypes: ['real'],
  traits: ['equality', 'order', 'numeric'],
  encode: (value) => value,
  decode: (wire) => wire,
});

const sqliteBlobDescriptor = codecDescriptor<
  typeof SQLITE_BLOB_CODEC_ID,
  readonly ['equality'],
  Uint8Array,
  Uint8Array
>({
  codecId: SQLITE_BLOB_CODEC_ID,
  targetTypes: ['blob'],
  traits: ['equality'],
  encode: (value) => value,
  decode: (wire) => wire,
  encodeJson: (value) => Buffer.from(value).toString('base64'),
  decodeJson: (json) => {
    if (typeof json !== 'string') {
      throw new TypeError('sqlite/blob@1 contract value must be a base64 string');
    }
    return new Uint8Array(Buffer.from(json, 'base64'));
  },
});

const sqliteDatetimeDescriptor = codecDescriptor<
  typeof SQLITE_DATETIME_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Date
>({
  codecId: SQLITE_DATETIME_CODEC_ID,
  targetTypes: ['text'],
  traits: ['equality', 'order'],
  encode: (value) => value.toISOString(),
  decode: (wire) => new Date(wire),
  encodeJson: (value) => value.toISOString(),
  decodeJson: (json) => {
    if (typeof json !== 'string') {
      throw new TypeError('sqlite/datetime@1 contract value must be an ISO-8601 string');
    }
    return new Date(json);
  },
});

const sqliteJsonDescriptor = codecDescriptor<
  typeof SQLITE_JSON_CODEC_ID,
  readonly ['equality'],
  string | JsonValue,
  JsonValue
>({
  codecId: SQLITE_JSON_CODEC_ID,
  targetTypes: ['text'],
  traits: ['equality'],
  encode: (value) => JSON.stringify(value),
  decode: (wire) => (typeof wire === 'string' ? (JSON.parse(wire) as JsonValue) : wire),
});

const sqliteBigintDescriptor = codecDescriptor<
  typeof SQLITE_BIGINT_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number | bigint,
  bigint
>({
  codecId: SQLITE_BIGINT_CODEC_ID,
  targetTypes: ['integer'],
  traits: ['equality', 'order', 'numeric'],
  encode: (value) => value,
  decode: (wire) => BigInt(wire),
  encodeJson: (value) => value.toString(),
  decodeJson: (json) => {
    if (typeof json !== 'string' && typeof json !== 'number') {
      throw new TypeError('sqlite/bigint@1 contract value must be a string or number');
    }
    return BigInt(json);
  },
});

const sqliteDescriptorsBuilder = defineCodecDescriptors()
  .add('char', sqlCharDescriptor)
  .add('varchar', sqlVarcharDescriptor)
  .add('int', sqlIntDescriptor)
  .add('float', sqlFloatDescriptor)
  .add('text', sqliteTextDescriptor)
  .add('integer', sqliteIntegerDescriptor)
  .add('real', sqliteRealDescriptor)
  .add('blob', sqliteBlobDescriptor)
  .add('datetime', sqliteDatetimeDescriptor)
  .add('json', sqliteJsonDescriptor)
  .add('bigint', sqliteBigintDescriptor);

/**
 * Descriptor view of the sqlite target codecs, keyed by scalar name.
 * Mirrors {@link codecDefinitions} for the descriptor shape (TML-2357
 * T2.4); the runtime contributor protocol switches to consume this map
 * once the unified `codecs:` slot lands later in M2.
 */
export const codecDescriptorDefinitions = sqliteDescriptorsBuilder.codecDefinitions;

/**
 * Flat array of every sqlite target codec descriptor — ready to feed
 * into a contributor's unified `codecs:` slot.
 */
export const codecDescriptorList = sqliteDescriptorsBuilder.descriptors;
