import type { JsonValue } from '@prisma-next/contract/types';
import { type as arktype } from 'arktype';
import {
  type AnyCodecDescriptor,
  type Codec,
  type DescriptorCodecInput,
  type DescriptorCodecTraits,
  defineCodec,
  type ExtractDescriptorCodecTypes,
} from './codec-types';

export const SQL_CHAR_CODEC_ID = 'sql/char@1' as const;
export const SQL_VARCHAR_CODEC_ID = 'sql/varchar@1' as const;
export const SQL_INT_CODEC_ID = 'sql/int@1' as const;
export const SQL_FLOAT_CODEC_ID = 'sql/float@1' as const;
export const SQL_TEXT_CODEC_ID = 'sql/text@1' as const;
export const SQL_TIMESTAMP_CODEC_ID = 'sql/timestamp@1' as const;

const lengthParamsSchema = arktype({
  length: 'number.integer > 0',
});

const precisionParamsSchema = arktype({
  'precision?': 'number.integer >= 0 & number.integer <= 6',
});

// ---------------------------------------------------------------------------
// Author surface: encode/decode/render extracted to module-level constants so
// every consumer (descriptor, materialized runtime codec, render-output-type
// tests) shares a single source of truth for runtime behaviour.
// ---------------------------------------------------------------------------

const sqlCharEncode = (value: string): string => value;
const sqlCharDecode = (wire: string): string => wire.trimEnd();
const sqlCharRenderOutputType = (typeParams: { readonly length?: number }) => {
  const length = typeParams.length;
  if (length === undefined) return undefined;
  if (typeof length !== 'number' || !Number.isFinite(length) || !Number.isInteger(length)) {
    throw new Error(
      `renderOutputType: expected integer "length" in typeParams for Char, got ${String(length)}`,
    );
  }
  return `Char<${length}>`;
};

const sqlVarcharEncode = (value: string): string => value;
const sqlVarcharDecode = (wire: string): string => wire;
const sqlVarcharRenderOutputType = (typeParams: { readonly length?: number }) => {
  const length = typeParams.length;
  if (length === undefined) return undefined;
  if (typeof length !== 'number' || !Number.isFinite(length) || !Number.isInteger(length)) {
    throw new Error(
      `renderOutputType: expected integer "length" in typeParams for Varchar, got ${String(length)}`,
    );
  }
  return `Varchar<${length}>`;
};

const sqlIntEncode = (value: number): number => value;
const sqlIntDecode = (wire: number): number => wire;

const sqlFloatEncode = (value: number): number => value;
const sqlFloatDecode = (wire: number): number => wire;

const sqlTextEncode = (value: string): string => value;
const sqlTextDecode = (wire: string): string => wire;

const sqlTimestampEncode = (value: Date): Date => value;
const sqlTimestampDecode = (wire: Date): Date => wire;
const sqlTimestampEncodeJson = (value: Date): JsonValue => value.toISOString();
const sqlTimestampDecodeJson = (json: JsonValue): Date => {
  if (typeof json !== 'string') {
    throw new Error(`Expected ISO date string for sql/timestamp@1, got ${typeof json}`);
  }
  const date = new Date(json);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO date string for sql/timestamp@1: ${json}`);
  }
  return date;
};
const sqlTimestampRenderOutputType = (typeParams: { readonly precision?: number }) => {
  const precision = typeParams.precision;
  if (precision === undefined) {
    return 'Timestamp';
  }
  if (
    typeof precision !== 'number' ||
    !Number.isFinite(precision) ||
    !Number.isInteger(precision)
  ) {
    throw new Error(
      `renderOutputType: expected integer "precision" in typeParams for Timestamp, got ${String(precision)}`,
    );
  }
  return `Timestamp<${precision}>`;
};

// ---------------------------------------------------------------------------
// Descriptor exports — the canonical source of truth for every SQL base
// codec. Contributors ship descriptors through the unified `codecs:` slot;
// the legacy `Codec` instances exposed via `sqlCodecDefinitions[k].codec`
// are derived from these descriptors below.
// ---------------------------------------------------------------------------

export const sqlCharDescriptor = defineCodec<
  typeof SQL_CHAR_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string,
  { readonly length?: number }
>({
  codecId: SQL_CHAR_CODEC_ID,
  targetTypes: ['char'],
  traits: ['equality', 'order', 'textual'],
  encode: sqlCharEncode,
  decode: sqlCharDecode,
  paramsSchema: lengthParamsSchema,
  renderOutputType: sqlCharRenderOutputType,
});

export const sqlVarcharDescriptor = defineCodec<
  typeof SQL_VARCHAR_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string,
  { readonly length?: number }
>({
  codecId: SQL_VARCHAR_CODEC_ID,
  targetTypes: ['varchar'],
  traits: ['equality', 'order', 'textual'],
  encode: sqlVarcharEncode,
  decode: sqlVarcharDecode,
  paramsSchema: lengthParamsSchema,
  renderOutputType: sqlVarcharRenderOutputType,
});

export const sqlIntDescriptor = defineCodec<
  typeof SQL_INT_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
>({
  codecId: SQL_INT_CODEC_ID,
  targetTypes: ['int'],
  traits: ['equality', 'order', 'numeric'],
  encode: sqlIntEncode,
  decode: sqlIntDecode,
});

export const sqlFloatDescriptor = defineCodec<
  typeof SQL_FLOAT_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
>({
  codecId: SQL_FLOAT_CODEC_ID,
  targetTypes: ['float'],
  traits: ['equality', 'order', 'numeric'],
  encode: sqlFloatEncode,
  decode: sqlFloatDecode,
});

export const sqlTextDescriptor = defineCodec<
  typeof SQL_TEXT_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
>({
  codecId: SQL_TEXT_CODEC_ID,
  targetTypes: ['text'],
  traits: ['equality', 'order', 'textual'],
  encode: sqlTextEncode,
  decode: sqlTextDecode,
});

export const sqlTimestampDescriptor = defineCodec<
  typeof SQL_TIMESTAMP_CODEC_ID,
  readonly ['equality', 'order'],
  Date,
  Date,
  { readonly precision?: number }
>({
  codecId: SQL_TIMESTAMP_CODEC_ID,
  targetTypes: ['timestamp'],
  traits: ['equality', 'order'],
  encode: sqlTimestampEncode,
  decode: sqlTimestampDecode,
  encodeJson: sqlTimestampEncodeJson,
  decodeJson: sqlTimestampDecodeJson,
  paramsSchema: precisionParamsSchema,
  renderOutputType: sqlTimestampRenderOutputType,
});

// ---------------------------------------------------------------------------
// Scalar-keyed views derived from the descriptor map. `sqlCodecDefinitions`
// (legacy `byScalar` shape with `.codec`) and `sqlCodecDescriptorDefinitions`
// (descriptor shape with `.descriptor`) are both produced by walking the
// descriptor map below; the `.codec` slot is materialized by invoking the
// descriptor's `factory(undefined)(ctx)` so the runtime instance carries
// only the narrow codec shape (`id` + four conversion methods).
// ---------------------------------------------------------------------------

const sqlDescriptors = {
  char: sqlCharDescriptor,
  varchar: sqlVarcharDescriptor,
  int: sqlIntDescriptor,
  float: sqlFloatDescriptor,
  text: sqlTextDescriptor,
  timestamp: sqlTimestampDescriptor,
} as const;

type SqlDescriptors = typeof sqlDescriptors;

function materializeDescriptorCodec(d: AnyCodecDescriptor): Codec {
  return d.factory(undefined as never)({
    name: `<shared:${d.codecId}>`,
  }) as Codec;
}

type SqlCodecDescriptorDefinitions = {
  readonly [K in keyof SqlDescriptors]: {
    readonly codecId: SqlDescriptors[K]['codecId'];
    readonly scalar: K;
    readonly descriptor: SqlDescriptors[K];
    readonly input: DescriptorCodecInput<SqlDescriptors[K]>;
    readonly output: DescriptorCodecInput<SqlDescriptors[K]>;
    readonly jsType: DescriptorCodecInput<SqlDescriptors[K]>;
  };
};

type SqlCodecDefinitions = {
  readonly [K in keyof SqlDescriptors]: {
    readonly typeId: SqlDescriptors[K]['codecId'];
    readonly scalar: K;
    readonly codec: Codec;
    readonly input: DescriptorCodecInput<SqlDescriptors[K]>;
    readonly output: DescriptorCodecInput<SqlDescriptors[K]>;
    readonly jsType: DescriptorCodecInput<SqlDescriptors[K]>;
    readonly traits: DescriptorCodecTraits<SqlDescriptors[K]>;
  };
};

type SqlDataTypes = {
  readonly [K in keyof SqlDescriptors]: SqlDescriptors[K]['codecId'];
};

function buildSqlCodecMaps(): {
  readonly definitions: SqlCodecDefinitions;
  readonly descriptorDefinitions: SqlCodecDescriptorDefinitions;
  readonly dataTypes: SqlDataTypes;
  readonly descriptorList: ReadonlyArray<AnyCodecDescriptor>;
} {
  const definitions: Record<string, unknown> = {};
  const descriptorDefinitions: Record<string, unknown> = {};
  const dataTypes: Record<string, string> = {};
  const descriptorList: AnyCodecDescriptor[] = [];

  for (const [scalar, descriptor] of Object.entries(sqlDescriptors)) {
    const d = descriptor as AnyCodecDescriptor;
    definitions[scalar] = {
      typeId: d.codecId,
      scalar,
      codec: materializeDescriptorCodec(d),
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
    definitions: definitions as unknown as SqlCodecDefinitions,
    descriptorDefinitions: descriptorDefinitions as unknown as SqlCodecDescriptorDefinitions,
    dataTypes: dataTypes as unknown as SqlDataTypes,
    descriptorList,
  };
}

const sqlCodecMaps = buildSqlCodecMaps();

/**
 * Scalar-keyed map of SQL base codec definitions. Each entry exposes
 * `typeId`, the materialized runtime `codec` instance (via the
 * descriptor's `factory(undefined)(ctx)`), and type-only `input` /
 * `output` / `jsType` / `traits` carriers.
 */
export const sqlCodecDefinitions: SqlCodecDefinitions = sqlCodecMaps.definitions;

/**
 * Scalar-keyed map mapping each scalar name to its codec id.
 */
export const sqlDataTypes: SqlDataTypes = sqlCodecMaps.dataTypes;

/**
 * Type-level codec id → `{input, output, traits}` map for builder
 * consumers that key by codec id rather than scalar name.
 */
export type SqlCodecTypes = ExtractDescriptorCodecTypes<SqlDescriptors>;

/**
 * Descriptor view of the SQL base codecs, keyed by scalar name. Mirrors
 * {@link sqlCodecDefinitions} on the descriptor side (TML-2357 M2).
 */
export const sqlCodecDescriptorDefinitions: SqlCodecDescriptorDefinitions =
  sqlCodecMaps.descriptorDefinitions;

/**
 * Flat array of every SQL base codec descriptor — ready to feed into a
 * contributor's unified `codecs:` slot.
 */
export const sqlCodecDescriptorList: ReadonlyArray<AnyCodecDescriptor> =
  sqlCodecMaps.descriptorList;
