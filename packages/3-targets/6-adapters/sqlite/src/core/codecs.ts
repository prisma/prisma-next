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
  encode: (value: string): string => value,
  decode: (wire: string): string => wire,
});

const sqliteIntegerCodec = codec<typeof SQLITE_INTEGER_CODEC_ID, number, number>({
  typeId: SQLITE_INTEGER_CODEC_ID,
  targetTypes: ['integer'],
  encode: (value) => value,
  decode: (wire) => wire,
});

const sqliteRealCodec = codec<typeof SQLITE_REAL_CODEC_ID, number, number>({
  typeId: SQLITE_REAL_CODEC_ID,
  targetTypes: ['real'],
  encode: (value) => value,
  decode: (wire) => wire,
});

const sqliteBlobCodec = codec<typeof SQLITE_BLOB_CODEC_ID, Uint8Array, Uint8Array>({
  typeId: SQLITE_BLOB_CODEC_ID,
  targetTypes: ['blob'],
  encode: (value) => value,
  decode: (wire) => wire,
});

const sqliteBooleanCodec = codec<typeof SQLITE_BOOLEAN_CODEC_ID, number, boolean>({
  typeId: SQLITE_BOOLEAN_CODEC_ID,
  targetTypes: ['integer'],
  encode: (value: boolean): number => (value ? 1 : 0),
  decode: (wire: number): boolean => wire !== 0,
});

const sqliteDatetimeCodec = codec<typeof SQLITE_DATETIME_CODEC_ID, string, Date>({
  typeId: SQLITE_DATETIME_CODEC_ID,
  targetTypes: ['text'],
  encode: (value: Date): string => value.toISOString(),
  decode: (wire: string): Date => new Date(wire),
});

const sqliteJsonCodec = codec<typeof SQLITE_JSON_CODEC_ID, string | JsonValue, JsonValue>({
  typeId: SQLITE_JSON_CODEC_ID,
  targetTypes: ['text'],
  encode: (value) => JSON.stringify(value),
  decode: (wire) => (typeof wire === 'string' ? JSON.parse(wire) : wire),
});

const sqliteBigintCodec = codec<typeof SQLITE_BIGINT_CODEC_ID, number | bigint, bigint>({
  typeId: SQLITE_BIGINT_CODEC_ID,
  targetTypes: ['integer'],
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
