/**
 * Unified codec definitions for the Postgres target.
 *
 * Single source of truth: every postgres codec is authored as a
 * `CodecDescriptor` via `defineCodec()` (or composed from a SQL base
 * descriptor via `aliasDescriptor`). The scalar-keyed `byScalar` map
 * (with the runtime `Codec` instance materialized through the
 * descriptor's `factory(undefined)(ctx)`), the `dataTypes` map, and the
 * compile-time `CodecTypes` map are all derived from the descriptor
 * map. The legacy factory + builder chain (renamed transiently in M2 R3)
 * was removed in TML-2357 M2 R4.
 */

import type { JsonValue } from '@prisma-next/contract/types';
import { aliasDescriptor } from '@prisma-next/framework-components/codec';
import {
  type AnyCodecDescriptor,
  type Codec,
  type DescriptorCodecInput,
  type DescriptorCodecTraits,
  defineCodec,
  type ExtractDescriptorCodecTypes,
  sqlCharDescriptor,
  sqlCodecDescriptorDefinitions,
  sqlFloatDescriptor,
  sqlIntDescriptor,
  sqlTextDescriptor,
  sqlTimestampDescriptor,
  sqlVarcharDescriptor,
} from '@prisma-next/sql-relational-core/ast';
import { type as arktype } from 'arktype';
import {
  PG_BIT_CODEC_ID,
  PG_BOOL_CODEC_ID,
  PG_BYTEA_CODEC_ID,
  PG_CHAR_CODEC_ID,
  PG_ENUM_CODEC_ID,
  PG_FLOAT_CODEC_ID,
  PG_FLOAT4_CODEC_ID,
  PG_FLOAT8_CODEC_ID,
  PG_INT_CODEC_ID,
  PG_INT2_CODEC_ID,
  PG_INT4_CODEC_ID,
  PG_INT8_CODEC_ID,
  PG_INTERVAL_CODEC_ID,
  PG_JSON_CODEC_ID,
  PG_JSONB_CODEC_ID,
  PG_NUMERIC_CODEC_ID,
  PG_TEXT_CODEC_ID,
  PG_TIME_CODEC_ID,
  PG_TIMESTAMP_CODEC_ID,
  PG_TIMESTAMPTZ_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
  PG_VARBIT_CODEC_ID,
  PG_VARCHAR_CODEC_ID,
} from './codec-ids';

const lengthParamsSchema = arktype({
  length: 'number.integer > 0',
});

const numericParamsSchema = arktype({
  precision: 'number.integer > 0 & number.integer <= 1000',
  'scale?': 'number.integer >= 0',
});

const precisionParamsSchema = arktype({
  'precision?': 'number.integer >= 0 & number.integer <= 6',
});

function renderLength(typeName: string, typeParams: Record<string, unknown>): string | undefined {
  const length = typeParams['length'];
  if (length === undefined) {
    return undefined;
  }
  if (typeof length !== 'number' || !Number.isFinite(length) || !Number.isInteger(length)) {
    throw new Error(
      `renderOutputType: expected integer "length" in typeParams for ${typeName}, got ${String(length)}`,
    );
  }
  return `${typeName}<${length}>`;
}

function renderPrecision(typeName: string, typeParams: Record<string, unknown>): string {
  const precision = typeParams['precision'];
  if (precision === undefined) {
    return typeName;
  }
  if (
    typeof precision !== 'number' ||
    !Number.isFinite(precision) ||
    !Number.isInteger(precision)
  ) {
    throw new Error(
      `renderOutputType: expected integer "precision" in typeParams for ${typeName}, got ${String(precision)}`,
    );
  }
  return `${typeName}<${precision}>`;
}

// Phase C: postgres' raw json/jsonb codecs no longer carry a
// `renderOutputType` slot — the schema-typed JSON surface that drove
// `typeParams: { schemaJson, type? }` retired in favor of the per-library
// extension package (`@prisma-next/extension-arktype-json`). Untyped
// json/jsonb columns have no typeParams; the framework emit path falls
// through to the generic `CodecTypes['pg/jsonb@1']['output']` accessor
// (which resolves to `JsonValue` via the codec-types map).

// ---------------------------------------------------------------------------
// CodecDescriptor source of truth. Each postgres target codec is authored
// via `defineCodec()` or composed from a SQL base descriptor via
// `aliasDescriptor`. Scalar-keyed `byScalar` / `dataTypes` /
// `codecDescriptorDefinitions` views are derived from the descriptor map
// at the bottom of the file.
// ---------------------------------------------------------------------------

const pgTextDescriptor = defineCodec<
  typeof PG_TEXT_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
>({
  codecId: PG_TEXT_CODEC_ID,
  targetTypes: ['text'],
  traits: ['equality', 'order', 'textual'],
  encode: (value) => value,
  decode: (wire) => wire,
  meta: { db: { sql: { postgres: { nativeType: 'text' } } } },
});

const pgCharDescriptor = aliasDescriptor(sqlCharDescriptor, {
  codecId: PG_CHAR_CODEC_ID,
  targetTypes: ['character'],
  meta: { db: { sql: { postgres: { nativeType: 'character' } } } },
});

const pgVarcharDescriptor = aliasDescriptor(sqlVarcharDescriptor, {
  codecId: PG_VARCHAR_CODEC_ID,
  targetTypes: ['character varying'],
  meta: { db: { sql: { postgres: { nativeType: 'character varying' } } } },
});

const pgIntDescriptor = aliasDescriptor(sqlIntDescriptor, {
  codecId: PG_INT_CODEC_ID,
  targetTypes: ['int4'],
  meta: { db: { sql: { postgres: { nativeType: 'integer' } } } },
});

const pgFloatDescriptor = aliasDescriptor(sqlFloatDescriptor, {
  codecId: PG_FLOAT_CODEC_ID,
  targetTypes: ['float8'],
  meta: { db: { sql: { postgres: { nativeType: 'double precision' } } } },
});

const pgInt4Descriptor = defineCodec<
  typeof PG_INT4_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
>({
  codecId: PG_INT4_CODEC_ID,
  targetTypes: ['int4'],
  traits: ['equality', 'order', 'numeric'],
  encode: (value) => value,
  decode: (wire) => wire,
  meta: { db: { sql: { postgres: { nativeType: 'integer' } } } },
});

const pgInt2Descriptor = defineCodec<
  typeof PG_INT2_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
>({
  codecId: PG_INT2_CODEC_ID,
  targetTypes: ['int2'],
  traits: ['equality', 'order', 'numeric'],
  encode: (value) => value,
  decode: (wire) => wire,
  meta: { db: { sql: { postgres: { nativeType: 'smallint' } } } },
});

const pgInt8Descriptor = defineCodec<
  typeof PG_INT8_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
>({
  codecId: PG_INT8_CODEC_ID,
  targetTypes: ['int8'],
  traits: ['equality', 'order', 'numeric'],
  encode: (value) => value,
  decode: (wire) => wire,
  meta: { db: { sql: { postgres: { nativeType: 'bigint' } } } },
});

const pgFloat4Descriptor = defineCodec<
  typeof PG_FLOAT4_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
>({
  codecId: PG_FLOAT4_CODEC_ID,
  targetTypes: ['float4'],
  traits: ['equality', 'order', 'numeric'],
  encode: (value) => value,
  decode: (wire) => wire,
  meta: { db: { sql: { postgres: { nativeType: 'real' } } } },
});

const pgFloat8Descriptor = defineCodec<
  typeof PG_FLOAT8_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
>({
  codecId: PG_FLOAT8_CODEC_ID,
  targetTypes: ['float8'],
  traits: ['equality', 'order', 'numeric'],
  encode: (value) => value,
  decode: (wire) => wire,
  meta: { db: { sql: { postgres: { nativeType: 'double precision' } } } },
});

const pgNumericDescriptor = defineCodec<
  typeof PG_NUMERIC_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  string | number,
  string,
  { readonly precision: number; readonly scale?: number }
>({
  codecId: PG_NUMERIC_CODEC_ID,
  targetTypes: ['numeric', 'decimal'],
  traits: ['equality', 'order', 'numeric'],
  encode: (value) => value,
  decode: (wire) => (typeof wire === 'number' ? String(wire) : wire),
  paramsSchema: numericParamsSchema,
  renderOutputType: (typeParams) => {
    const precision = typeParams.precision;
    if (precision === undefined) return undefined;
    if (
      typeof precision !== 'number' ||
      !Number.isFinite(precision) ||
      !Number.isInteger(precision)
    ) {
      throw new Error(
        `renderOutputType: expected integer "precision" in typeParams for Numeric, got ${String(precision)}`,
      );
    }
    const scale = typeParams.scale;
    return typeof scale === 'number' ? `Numeric<${precision}, ${scale}>` : `Numeric<${precision}>`;
  },
  meta: { db: { sql: { postgres: { nativeType: 'numeric' } } } },
});

const pgTimestampDescriptor = defineCodec<
  typeof PG_TIMESTAMP_CODEC_ID,
  readonly ['equality', 'order'],
  Date,
  Date,
  { readonly precision?: number }
>({
  codecId: PG_TIMESTAMP_CODEC_ID,
  targetTypes: ['timestamp'],
  traits: ['equality', 'order'],
  encode: (value) => value,
  decode: (wire) => wire,
  encodeJson: (value) => value.toISOString(),
  decodeJson: (json) => {
    if (typeof json !== 'string') {
      throw new Error(`Expected ISO date string for pg/timestamp@1, got ${typeof json}`);
    }
    const date = new Date(json);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid ISO date string for pg/timestamp@1: ${json}`);
    }
    return date;
  },
  paramsSchema: precisionParamsSchema,
  renderOutputType: (typeParams) =>
    renderPrecision('Timestamp', typeParams as Record<string, unknown>),
  meta: { db: { sql: { postgres: { nativeType: 'timestamp without time zone' } } } },
});

const pgTimestamptzDescriptor = defineCodec<
  typeof PG_TIMESTAMPTZ_CODEC_ID,
  readonly ['equality', 'order'],
  Date,
  Date,
  { readonly precision?: number }
>({
  codecId: PG_TIMESTAMPTZ_CODEC_ID,
  targetTypes: ['timestamptz'],
  traits: ['equality', 'order'],
  encode: (value) => value,
  decode: (wire) => wire,
  encodeJson: (value) => value.toISOString(),
  decodeJson: (json) => {
    if (typeof json !== 'string') {
      throw new Error(`Expected ISO date string for pg/timestamptz@1, got ${typeof json}`);
    }
    const date = new Date(json);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid ISO date string for pg/timestamptz@1: ${json}`);
    }
    return date;
  },
  paramsSchema: precisionParamsSchema,
  renderOutputType: (typeParams) =>
    renderPrecision('Timestamptz', typeParams as Record<string, unknown>),
  meta: { db: { sql: { postgres: { nativeType: 'timestamp with time zone' } } } },
});

const pgTimeDescriptor = defineCodec<
  typeof PG_TIME_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string,
  { readonly precision?: number }
>({
  codecId: PG_TIME_CODEC_ID,
  targetTypes: ['time'],
  traits: ['equality', 'order'],
  encode: (value) => value,
  decode: (wire) => wire,
  paramsSchema: precisionParamsSchema,
  renderOutputType: (typeParams) => renderPrecision('Time', typeParams as Record<string, unknown>),
  meta: { db: { sql: { postgres: { nativeType: 'time' } } } },
});

const pgTimetzDescriptor = defineCodec<
  typeof PG_TIMETZ_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string,
  { readonly precision?: number }
>({
  codecId: PG_TIMETZ_CODEC_ID,
  targetTypes: ['timetz'],
  traits: ['equality', 'order'],
  encode: (value) => value,
  decode: (wire) => wire,
  paramsSchema: precisionParamsSchema,
  renderOutputType: (typeParams) =>
    renderPrecision('Timetz', typeParams as Record<string, unknown>),
  meta: { db: { sql: { postgres: { nativeType: 'timetz' } } } },
});

const pgBoolDescriptor = defineCodec<
  typeof PG_BOOL_CODEC_ID,
  readonly ['equality', 'boolean'],
  boolean,
  boolean
>({
  codecId: PG_BOOL_CODEC_ID,
  targetTypes: ['bool'],
  traits: ['equality', 'boolean'],
  encode: (value) => value,
  decode: (wire) => wire,
  meta: { db: { sql: { postgres: { nativeType: 'boolean' } } } },
});

const pgBitDescriptor = defineCodec<
  typeof PG_BIT_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string,
  { readonly length?: number }
>({
  codecId: PG_BIT_CODEC_ID,
  targetTypes: ['bit'],
  traits: ['equality', 'order'],
  encode: (value) => value,
  decode: (wire) => wire,
  paramsSchema: lengthParamsSchema,
  renderOutputType: (typeParams) => renderLength('Bit', typeParams as Record<string, unknown>),
  meta: { db: { sql: { postgres: { nativeType: 'bit' } } } },
});

const pgVarbitDescriptor = defineCodec<
  typeof PG_VARBIT_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string,
  { readonly length?: number }
>({
  codecId: PG_VARBIT_CODEC_ID,
  targetTypes: ['bit varying'],
  traits: ['equality', 'order'],
  encode: (value) => value,
  decode: (wire) => wire,
  paramsSchema: lengthParamsSchema,
  renderOutputType: (typeParams) => renderLength('VarBit', typeParams as Record<string, unknown>),
  meta: { db: { sql: { postgres: { nativeType: 'bit varying' } } } },
});

const pgByteaDescriptor = defineCodec<
  typeof PG_BYTEA_CODEC_ID,
  readonly ['equality'],
  Uint8Array,
  Uint8Array
>({
  codecId: PG_BYTEA_CODEC_ID,
  targetTypes: ['bytea'],
  traits: ['equality'],
  encode: (value) => value,
  decode: (wire) =>
    // Postgres node drivers commonly return Buffer instances (which extend
    // Uint8Array) — normalize to a plain Uint8Array view so engine-agnostic
    // consumers don't accidentally observe Buffer-specific APIs.
    wire instanceof Uint8Array && wire.constructor === Uint8Array
      ? wire
      : new Uint8Array(wire.buffer, wire.byteOffset, wire.byteLength),
  encodeJson: (value) => Buffer.from(value).toString('base64'),
  decodeJson: (json) => {
    if (typeof json !== 'string') {
      throw new Error(`Expected base64 string for pg/bytea@1, got ${typeof json}`);
    }
    const decoded = Buffer.from(json, 'base64');
    if (decoded.toString('base64') !== json) {
      throw new Error(`Invalid base64 string for pg/bytea@1 (length: ${json.length})`);
    }
    return new Uint8Array(decoded);
  },
  meta: { db: { sql: { postgres: { nativeType: 'bytea' } } } },
});

const pgEnumDescriptor = defineCodec<
  typeof PG_ENUM_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string,
  { readonly values?: readonly unknown[] }
>({
  codecId: PG_ENUM_CODEC_ID,
  targetTypes: ['enum'],
  traits: ['equality', 'order'],
  encode: (value) => value,
  decode: (wire) => wire,
  renderOutputType: (typeParams) => {
    const values = typeParams.values;
    if (!Array.isArray(values)) {
      throw new Error(
        `renderOutputType: expected array "values" in typeParams for enum, got ${typeof values}`,
      );
    }
    return values
      .map((value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
      .join(' | ');
  },
});

const pgIntervalDescriptor = defineCodec<
  typeof PG_INTERVAL_CODEC_ID,
  readonly ['equality', 'order'],
  string | Record<string, unknown>,
  string,
  { readonly precision?: number }
>({
  codecId: PG_INTERVAL_CODEC_ID,
  targetTypes: ['interval'],
  traits: ['equality', 'order'],
  encode: (value) => value,
  decode: (wire) => (typeof wire === 'string' ? wire : JSON.stringify(wire)),
  paramsSchema: precisionParamsSchema,
  renderOutputType: (typeParams) =>
    renderPrecision('Interval', typeParams as Record<string, unknown>),
  meta: { db: { sql: { postgres: { nativeType: 'interval' } } } },
});

const pgJsonDescriptor = defineCodec<
  typeof PG_JSON_CODEC_ID,
  readonly [],
  string | JsonValue,
  JsonValue
>({
  codecId: PG_JSON_CODEC_ID,
  targetTypes: ['json'],
  traits: [],
  encode: (value) => JSON.stringify(value),
  decode: (wire) => (typeof wire === 'string' ? JSON.parse(wire) : wire),
  meta: { db: { sql: { postgres: { nativeType: 'json' } } } },
});

const pgJsonbDescriptor = defineCodec<
  typeof PG_JSONB_CODEC_ID,
  readonly ['equality'],
  string | JsonValue,
  JsonValue
>({
  codecId: PG_JSONB_CODEC_ID,
  targetTypes: ['jsonb'],
  traits: ['equality'],
  encode: (value) => JSON.stringify(value),
  decode: (wire) => (typeof wire === 'string' ? JSON.parse(wire) : wire),
  meta: { db: { sql: { postgres: { nativeType: 'jsonb' } } } },
});

// ---------------------------------------------------------------------------
// Scalar-keyed view derived from the descriptor map. The four SQL-base
// scalars (`char`, `varchar`, `int`, `float`) inherit the SQL family
// descriptor; the two `sql-text` / `sql-timestamp` scalars carry the SQL
// family text/timestamp descriptors directly. The runtime `Codec`
// instance in each `byScalar[k].codec` slot is materialized from the
// descriptor's `factory(undefined)(ctx)` so the runtime instance carries
// only the narrow shape (`id` plus four conversion methods).
// ---------------------------------------------------------------------------

const pgDescriptors = {
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

type PgDescriptors = typeof pgDescriptors;

function materializeDescriptorCodec(d: AnyCodecDescriptor): Codec {
  return d.factory(undefined as never)({
    name: `<shared:${d.codecId}>`,
  }) as Codec;
}

type PgByScalar = {
  readonly [K in keyof PgDescriptors]: {
    readonly typeId: PgDescriptors[K]['codecId'];
    readonly scalar: K;
    readonly codec: Codec;
    readonly input: DescriptorCodecInput<PgDescriptors[K]>;
    readonly output: DescriptorCodecInput<PgDescriptors[K]>;
    readonly jsType: DescriptorCodecInput<PgDescriptors[K]>;
    readonly traits: DescriptorCodecTraits<PgDescriptors[K]>;
  };
};

type PgCodecDescriptorDefinitions = {
  readonly [K in keyof PgDescriptors]: {
    readonly codecId: PgDescriptors[K]['codecId'];
    readonly scalar: K;
    readonly descriptor: PgDescriptors[K];
    readonly input: DescriptorCodecInput<PgDescriptors[K]>;
    readonly output: DescriptorCodecInput<PgDescriptors[K]>;
    readonly jsType: DescriptorCodecInput<PgDescriptors[K]>;
  };
};

type PgDataTypes = {
  readonly [K in keyof PgDescriptors]: PgDescriptors[K]['codecId'];
};

function buildPgCodecMaps(): {
  readonly byScalar: PgByScalar;
  readonly descriptorDefinitions: PgCodecDescriptorDefinitions;
  readonly dataTypes: PgDataTypes;
  readonly descriptorList: ReadonlyArray<AnyCodecDescriptor>;
} {
  // Seed the SQL-base scalar codec slots from the SQL-base descriptor
  // definitions so `byScalar.{char,varchar,int,float,sql-text,sql-timestamp}.codec`
  // shares the SQL family materialization (preserves identity across
  // postgres + sqlite consumers reading from these slots).
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
    'sql-text': sqlCodecDescriptorDefinitions.text.descriptor.factory(undefined as never)({
      name: `<shared:${sqlTextDescriptor.codecId}>`,
    }) as Codec,
    'sql-timestamp': sqlCodecDescriptorDefinitions.timestamp.descriptor.factory(undefined as never)(
      {
        name: `<shared:${sqlTimestampDescriptor.codecId}>`,
      },
    ) as Codec,
  };

  const byScalar: Record<string, unknown> = {};
  const descriptorDefinitions: Record<string, unknown> = {};
  const dataTypes: Record<string, string> = {};
  const descriptorList: AnyCodecDescriptor[] = [];

  for (const [scalar, descriptor] of Object.entries(pgDescriptors)) {
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
    byScalar: byScalar as unknown as PgByScalar,
    descriptorDefinitions: descriptorDefinitions as unknown as PgCodecDescriptorDefinitions,
    dataTypes: dataTypes as unknown as PgDataTypes,
    descriptorList,
  };
}

const pgCodecMaps = buildPgCodecMaps();

/**
 * Scalar-keyed map of postgres codec definitions. Each entry exposes
 * `typeId`, the materialized runtime `codec` instance (via the
 * descriptor's `factory(undefined)(ctx)`), and type-only `input` /
 * `output` / `jsType` / `traits` carriers.
 */
export const byScalar: PgByScalar = pgCodecMaps.byScalar;

/**
 * Scalar-keyed map mapping each scalar name to its codec id.
 */
export const dataTypes: PgDataTypes = pgCodecMaps.dataTypes;

/**
 * Type-level codec id → `{input, output, traits}` map for builder
 * consumers that key by codec id rather than scalar name.
 */
export type CodecTypes = ExtractDescriptorCodecTypes<PgDescriptors>;

/**
 * Descriptor view of the postgres target codecs, keyed by scalar name.
 * Mirrors {@link byScalar} on the descriptor side (TML-2357 T2.3).
 */
export const codecDescriptorDefinitions: PgCodecDescriptorDefinitions =
  pgCodecMaps.descriptorDefinitions;

/**
 * Flat array of every postgres target codec descriptor — ready to feed
 * into a contributor's unified `codecs:` slot.
 */
export const codecDescriptorList: ReadonlyArray<AnyCodecDescriptor> = pgCodecMaps.descriptorList;
