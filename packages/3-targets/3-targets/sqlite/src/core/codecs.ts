import {
  type AnyCodecDescriptor,
  type Codec,
  type DescriptorCodecInput,
  type DescriptorCodecTraits,
  type DescriptorResolvedCodec,
  defineCodec,
  type ExtractDescriptorCodecTypes,
  sqlCharDescriptor,
  sqlCodecDescriptorDefinitions,
  sqlFloatDescriptor,
  sqlIntDescriptor,
  sqlVarcharDescriptor,
} from '@prisma-next/sql-relational-core/ast';
import {
  SQLITE_BIGINT_CODEC_ID,
  SQLITE_BLOB_CODEC_ID,
  SQLITE_DATETIME_CODEC_ID,
  SQLITE_INTEGER_CODEC_ID,
  SQLITE_JSON_CODEC_ID,
  SQLITE_REAL_CODEC_ID,
  SQLITE_TEXT_CODEC_ID,
} from './codec-ids';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

// ---------------------------------------------------------------------------
// CodecDescriptor source of truth. Each sqlite target codec is authored
// via `defineCodec()` or inherited from a SQL base descriptor. Scalar-keyed
// `byScalar` / `dataTypes` / `codecDescriptorDefinitions` views are
// derived from the descriptor map at the bottom of the file.
// ---------------------------------------------------------------------------

const sqliteTextDescriptor = defineCodec<
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

const sqliteIntegerDescriptor = defineCodec<
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

const sqliteRealDescriptor = defineCodec<
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

const sqliteBlobDescriptor = defineCodec<
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

const sqliteDatetimeDescriptor = defineCodec<
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

const sqliteJsonDescriptor = defineCodec<
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

const sqliteBigintDescriptor = defineCodec<
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

// ---------------------------------------------------------------------------
// Scalar-keyed view derived from the descriptor map. The four SQL-base
// scalars (`char`, `varchar`, `int`, `float`) inherit the SQL family
// descriptor; runtime codec instances on `byScalar[k].codec` are
// materialized through the descriptor's `factory(undefined)(ctx)` so they
// carry only the narrow shape (`id` plus four conversion methods).
// ---------------------------------------------------------------------------

const sqliteDescriptors = {
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

type SqliteDescriptors = typeof sqliteDescriptors;

function materializeDescriptorCodec(d: AnyCodecDescriptor): Codec {
  return d.factory(undefined as never)({
    name: `<shared:${d.codecId}>`,
  }) as Codec;
}

type SqliteByScalar = {
  readonly [K in keyof SqliteDescriptors]: {
    readonly typeId: SqliteDescriptors[K]['codecId'];
    readonly scalar: K;
    readonly codec: DescriptorResolvedCodec<SqliteDescriptors[K]> & Codec;
    readonly input: DescriptorCodecInput<SqliteDescriptors[K]>;
    readonly output: DescriptorCodecInput<SqliteDescriptors[K]>;
    readonly jsType: DescriptorCodecInput<SqliteDescriptors[K]>;
    readonly traits: DescriptorCodecTraits<SqliteDescriptors[K]>;
  };
};

type SqliteCodecDescriptorDefinitions = {
  readonly [K in keyof SqliteDescriptors]: {
    readonly codecId: SqliteDescriptors[K]['codecId'];
    readonly scalar: K;
    readonly descriptor: SqliteDescriptors[K];
    readonly input: DescriptorCodecInput<SqliteDescriptors[K]>;
    readonly output: DescriptorCodecInput<SqliteDescriptors[K]>;
    readonly jsType: DescriptorCodecInput<SqliteDescriptors[K]>;
  };
};

type SqliteDataTypes = {
  readonly [K in keyof SqliteDescriptors]: SqliteDescriptors[K]['codecId'];
};

function buildSqliteCodecMaps(): {
  readonly byScalar: SqliteByScalar;
  readonly descriptorDefinitions: SqliteCodecDescriptorDefinitions;
  readonly dataTypes: SqliteDataTypes;
  readonly descriptorList: ReadonlyArray<AnyCodecDescriptor>;
} {
  // Seed the SQL-base scalar codec slots from the SQL-base descriptor
  // definitions so every consumer sharing the SQL family materialization
  // sees the same codec identity.
  const sqlSeeded: Record<string, Codec> = {
    char: sqlCodecDescriptorDefinitions.char.descriptor.factory(undefined as never)({
      name: `<shared:${sqlCharDescriptor.codecId}>`,
    }) as Codec,
    varchar: sqlCodecDescriptorDefinitions.varchar.descriptor.factory(undefined as never)({
      name: `<shared:${sqlVarcharDescriptor.codecId}>`,
    }) as Codec,
    int: sqlCodecDescriptorDefinitions.int.descriptor.factory(undefined as never)({
      name: `<shared:${sqlIntDescriptor.codecId}>`,
    }) as Codec,
    float: sqlCodecDescriptorDefinitions.float.descriptor.factory(undefined as never)({
      name: `<shared:${sqlFloatDescriptor.codecId}>`,
    }) as Codec,
  };

  const byScalar: Record<string, unknown> = {};
  const descriptorDefinitions: Record<string, unknown> = {};
  const dataTypes: Record<string, string> = {};
  const descriptorList: AnyCodecDescriptor[] = [];

  for (const [scalar, descriptor] of Object.entries(sqliteDescriptors)) {
    const d = descriptor as AnyCodecDescriptor;
    const codec = sqlSeeded[scalar] ?? materializeDescriptorCodec(d);
    byScalar[scalar] = {
      typeId: d.codecId,
      scalar,
      codec,
      input: undefined,
      output: undefined,
      jsType: undefined,
      traits: undefined,
    };
    descriptorDefinitions[scalar] = {
      codecId: d.codecId,
      scalar,
      descriptor: d,
      input: undefined,
      output: undefined,
      jsType: undefined,
    };
    dataTypes[scalar] = d.codecId;
    descriptorList.push(d);
  }

  return {
    byScalar: byScalar as unknown as SqliteByScalar,
    descriptorDefinitions: descriptorDefinitions as unknown as SqliteCodecDescriptorDefinitions,
    dataTypes: dataTypes as unknown as SqliteDataTypes,
    descriptorList,
  };
}

const sqliteCodecMaps = buildSqliteCodecMaps();

export const byScalar: SqliteByScalar = sqliteCodecMaps.byScalar;
export const dataTypes: SqliteDataTypes = sqliteCodecMaps.dataTypes;
export type CodecTypes = ExtractDescriptorCodecTypes<SqliteDescriptors>;

/**
 * Descriptor view of the sqlite target codecs, keyed by scalar name.
 * Mirrors {@link byScalar} on the descriptor side (TML-2357 T2.4).
 */
export const codecDescriptorDefinitions: SqliteCodecDescriptorDefinitions =
  sqliteCodecMaps.descriptorDefinitions;

/**
 * Flat array of every sqlite target codec descriptor — ready to feed into
 * a contributor's unified `codecs:` slot.
 */
export const codecDescriptorList: ReadonlyArray<AnyCodecDescriptor> =
  sqliteCodecMaps.descriptorList;
