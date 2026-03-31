import { codec, defineCodecs, sqlCodecDefinitions } from '@prisma-next/sql-relational-core/ast';
import {
  SQLITE_BIGINT_CODEC_ID,
  SQLITE_BLOB_CODEC_ID,
  SQLITE_BOOLEAN_CODEC_ID,
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
});

const sqliteBooleanCodec = codec({
  typeId: SQLITE_BOOLEAN_CODEC_ID,
  targetTypes: ['integer'],
  traits: ['equality', 'boolean'],
  encode: (value: boolean): number => (value ? 1 : 0),
  decode: (wire: number): boolean => wire !== 0,
});

const sqliteDatetimeCodec = codec({
  typeId: SQLITE_DATETIME_CODEC_ID,
  targetTypes: ['text'],
  traits: ['equality', 'order'],
  encode: (value: Date): string => value.toISOString(),
  decode: (wire: string): Date => new Date(wire),
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
  .add('boolean', sqliteBooleanCodec)
  .add('datetime', sqliteDatetimeCodec)
  .add('json', sqliteJsonCodec)
  .add('bigint', sqliteBigintCodec);

export const codecDefinitions = codecs.codecDefinitions;
export const dataTypes = codecs.dataTypes;

export type CodecTypes = typeof codecs.CodecTypes;
