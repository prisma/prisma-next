/**
 * Framework-registration descriptors for every Postgres parameterized codec.
 *
 * Each descriptor pairs a codec id with a curried higher-order codec factory
 * (from `../core/parameterized-codec-factories.ts`), a Standard-Schema params
 * validator, and an emit-path renderer. The renderer logic was lifted from
 * the pre-M4 codec-object `renderOutputType` hooks so the emit path produces
 * byte-identical output once the codec-object hooks are retired (M4 cleanup
 * F01).
 *
 * Codec-model-unification project, M4 cleanup F01.
 */

import type {
  Codec,
  Ctx,
  ParameterizedCodecDescriptor,
} from '@prisma-next/framework-components/codec';
import { type as arktype } from 'arktype';
import {
  PG_BIT_CODEC_ID,
  PG_CHAR_CODEC_ID,
  PG_ENUM_CODEC_ID,
  PG_INTERVAL_CODEC_ID,
  PG_JSON_CODEC_ID,
  PG_JSONB_CODEC_ID,
  PG_NUMERIC_CODEC_ID,
  PG_TIME_CODEC_ID,
  PG_TIMESTAMP_CODEC_ID,
  PG_TIMESTAMPTZ_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
  PG_VARBIT_CODEC_ID,
  PG_VARCHAR_CODEC_ID,
  SQL_CHAR_CODEC_ID,
  SQL_TIMESTAMP_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
} from '../core/codec-ids';
import { renderTypeScriptTypeFromJsonSchema } from '../core/json-schema-type-expression';
import {
  bitCodecForLength,
  charCodecForLength,
  intervalCodecForPrecision,
  numericCodecForParams,
  timeCodecForPrecision,
  timestampCodecForPrecision,
  timestamptzCodecForPrecision,
  timetzCodecForPrecision,
  varbitCodecForLength,
  varcharCodecForLength,
} from '../core/parameterized-codec-factories';

const lengthParamsSchema = arktype({
  length: 'number.integer > 0',
});

const precisionParamsSchema = arktype({
  'precision?': 'number.integer >= 0 & number.integer <= 6',
});

const numericParamsSchema = arktype({
  precision: 'number.integer > 0 & number.integer <= 1000',
  'scale?': 'number.integer >= 0',
});

function renderLength(typeName: string, params: { readonly length: number }): string {
  return `${typeName}<${params.length}>`;
}

function renderPrecision(typeName: string, params: { readonly precision?: number }): string {
  if (params.precision === undefined) return typeName;
  return `${typeName}<${params.precision}>`;
}

// ── Char / Varchar (length-parameterized strings) ────────────────────────

export const sqlCharCodec: ParameterizedCodecDescriptor<{ readonly length: number }> = {
  codecId: SQL_CHAR_CODEC_ID,
  paramsSchema: lengthParamsSchema,
  renderOutputType: (params) => renderLength('Char', params),
  factory: ({ length }) => charCodecForLength(length),
};

export const sqlVarcharCodec: ParameterizedCodecDescriptor<{ readonly length: number }> = {
  codecId: SQL_VARCHAR_CODEC_ID,
  paramsSchema: lengthParamsSchema,
  renderOutputType: (params) => renderLength('Varchar', params),
  factory: ({ length }) => varcharCodecForLength(length),
};

export const pgCharCodec: ParameterizedCodecDescriptor<{ readonly length: number }> = {
  codecId: PG_CHAR_CODEC_ID,
  paramsSchema: lengthParamsSchema,
  renderOutputType: (params) => renderLength('Char', params),
  factory: ({ length }) => charCodecForLength(length),
};

export const pgVarcharCodec: ParameterizedCodecDescriptor<{ readonly length: number }> = {
  codecId: PG_VARCHAR_CODEC_ID,
  paramsSchema: lengthParamsSchema,
  renderOutputType: (params) => renderLength('Varchar', params),
  factory: ({ length }) => varcharCodecForLength(length),
};

// ── Bit / VarBit ─────────────────────────────────────────────────────────

export const pgBitCodec: ParameterizedCodecDescriptor<{ readonly length: number }> = {
  codecId: PG_BIT_CODEC_ID,
  paramsSchema: lengthParamsSchema,
  renderOutputType: (params) => renderLength('Bit', params),
  factory: ({ length }) => bitCodecForLength(length),
};

export const pgVarbitCodec: ParameterizedCodecDescriptor<{ readonly length: number }> = {
  codecId: PG_VARBIT_CODEC_ID,
  paramsSchema: lengthParamsSchema,
  renderOutputType: (params) => renderLength('VarBit', params),
  factory: ({ length }) => varbitCodecForLength(length),
};

// ── Numeric ──────────────────────────────────────────────────────────────

export const pgNumericCodec: ParameterizedCodecDescriptor<{
  readonly precision: number;
  readonly scale?: number;
}> = {
  codecId: PG_NUMERIC_CODEC_ID,
  paramsSchema: numericParamsSchema,
  renderOutputType: ({ precision, scale }) =>
    typeof scale === 'number' ? `Numeric<${precision}, ${scale}>` : `Numeric<${precision}>`,
  factory: ({ precision, scale }) => numericCodecForParams(precision, scale),
};

// ── Timestamp / Timestamptz / Time / Timetz / Interval ───────────────────

export const sqlTimestampCodec: ParameterizedCodecDescriptor<{ readonly precision?: number }> = {
  codecId: SQL_TIMESTAMP_CODEC_ID,
  paramsSchema: precisionParamsSchema,
  renderOutputType: (params) => renderPrecision('Timestamp', params),
  factory: ({ precision }) => timestampCodecForPrecision(precision),
};

export const pgTimestampCodec: ParameterizedCodecDescriptor<{ readonly precision?: number }> = {
  codecId: PG_TIMESTAMP_CODEC_ID,
  paramsSchema: precisionParamsSchema,
  renderOutputType: (params) => renderPrecision('Timestamp', params),
  factory: ({ precision }) => timestampCodecForPrecision(precision),
};

export const pgTimestamptzCodec: ParameterizedCodecDescriptor<{ readonly precision?: number }> = {
  codecId: PG_TIMESTAMPTZ_CODEC_ID,
  paramsSchema: precisionParamsSchema,
  renderOutputType: (params) => renderPrecision('Timestamptz', params),
  factory: ({ precision }) => timestamptzCodecForPrecision(precision),
};

export const pgTimeCodec: ParameterizedCodecDescriptor<{ readonly precision?: number }> = {
  codecId: PG_TIME_CODEC_ID,
  paramsSchema: precisionParamsSchema,
  renderOutputType: (params) => renderPrecision('Time', params),
  factory: ({ precision }) => timeCodecForPrecision(precision),
};

export const pgTimetzCodec: ParameterizedCodecDescriptor<{ readonly precision?: number }> = {
  codecId: PG_TIMETZ_CODEC_ID,
  paramsSchema: precisionParamsSchema,
  renderOutputType: (params) => renderPrecision('Timetz', params),
  factory: ({ precision }) => timetzCodecForPrecision(precision),
};

export const pgIntervalCodec: ParameterizedCodecDescriptor<{ readonly precision?: number }> = {
  codecId: PG_INTERVAL_CODEC_ID,
  paramsSchema: precisionParamsSchema,
  renderOutputType: (params) => renderPrecision('Interval', params),
  factory: ({ precision }) => intervalCodecForPrecision(precision),
};

// ── Enum (values list -> literal-union output) ───────────────────────────

const enumParamsSchema = arktype({
  values: 'string[]',
});

const enumPlaceholderFactory =
  (_params: { readonly values: readonly string[] }) =>
  (_ctx: Ctx): Codec => {
    throw new Error(
      'pgEnumCodec.factory is registration-only at M4 (the enum codec lives in the legacy codec registry).',
    );
  };

export const pgEnumCodec: ParameterizedCodecDescriptor<{ readonly values: readonly string[] }> = {
  codecId: PG_ENUM_CODEC_ID,
  paramsSchema: enumParamsSchema,
  renderOutputType: ({ values }) =>
    values
      .map((value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
      .join(' | '),
  // The enum codec is registered through the legacy codec registry today
  // (see `core/codecs.ts`); the descriptor exists only to provide
  // `renderOutputType` to the emitter. The factory placeholder satisfies the
  // descriptor shape; M4'"'"'s emit path never invokes it.
  factory: enumPlaceholderFactory,
};

// ── JSON / JSONB (legacy-typeParams emit-path renderer) ──────────────────
//
// The postgres adapter currently carries three coexisting representations of
// the JSON / JSONB codecs, one per surface. They are wired by **surface
// segregation** — each is registered with a different framework slot from a
// different exports module — not by any dynamic dispatch at runtime:
//
//   1. `pgJsonCodec` / `pgJsonbCodec` (M3, schema-typed): live in
//      `../codecs/json-factory.ts`, exported from `../exports/codecs.ts`.
//      Column-author surface — users write `json(productSchema)` and the
//      descriptor's `type` slot threads a `(ctx) => Codec<…, InferOutput<S>>`
//      factory into `ColumnTypeDescriptor` for the no-emit `FieldOutputType`
//      resolver. Their params shape is `{ schema: StandardSchemaV1 }` (live).
//
//   2. `pgJsonLegacyCodec` / `pgJsonbLegacyCodec` (M4, defined below):
//      registered from `../exports/control.ts` via the
//      `parameterizedCodecs` slot. Control / emit surface — the emitter reads
//      `renderOutputType` off this descriptor to render `contract.d.ts` from
//      the contract IR's serialized typeParams shape `{ schemaJson, type? }`.
//      Their `factory` is a registration-only placeholder (the runtime side
//      owns instantiation; see #3).
//
//   3. `pgJsonRuntimeFactory` / `pgJsonbRuntimeFactory`
//      (`../codecs/json-runtime-factory.ts`): registered from
//      `../exports/runtime.ts` via the runtime adapter's `parameterizedCodecs`
//      slot. Runtime surface — at contract-load `sql-runtime` invokes
//      `factory(typeParams)(ctx)` to materialize a `JsonCodecInstance`
//      carrying the compiled `validate` function (gated by the
//      `'json-validator'` `CodecTrait`).
//
// Why three: the IR's serialized `typeParams` shape (`{ schemaJson, type? }`)
// can't reconstitute a live Standard Schema, so the schema-typed factory
// (#1) is unsuitable for the emit and runtime surfaces; conversely, #2/#3
// don't carry the schema's `InferOutput` at the type level. Each surface
// picks the descriptor that matches its inputs.
//
// Future unification is tracked under TML-2330: collapse the IR `typeParams`
// shape and the descriptor surfaces so a single descriptor handles
// no-emit type inference, emit-time rendering, and runtime instantiation.

function renderJsonOutputType(typeParams: {
  readonly schemaJson?: unknown;
  readonly type?: string;
}): string {
  const typeName = typeParams.type;
  if (typeof typeName === 'string' && typeName.trim().length > 0) {
    return typeName.trim();
  }
  const schema = typeParams.schemaJson;
  if (schema && typeof schema === 'object') {
    return renderTypeScriptTypeFromJsonSchema(schema);
  }
  return 'unknown';
}

type JsonLegacyParams = { readonly schemaJson?: Record<string, unknown>; readonly type?: string };

const jsonLegacyArktype = arktype({
  'schemaJson?': 'object',
  'type?': 'string',
});

// arktype's inferred params shape uses plain `object`; the descriptor accepts
// the more precise `Record<string, unknown>` for `schemaJson` to give the
// `renderTypeScriptTypeFromJsonSchema` helper a typed input. Cast at the
// boundary so runtime semantics are unchanged.
const jsonLegacyParamsSchema =
  jsonLegacyArktype as unknown as import('@standard-schema/spec').StandardSchemaV1<JsonLegacyParams>;

function jsonLegacyPlaceholderFactory(_params: JsonLegacyParams) {
  return (_ctx: Ctx): Codec => {
    throw new Error(
      'pgJsonLegacyCodec.factory is registration-only at M4; the runtime descriptor at exports/runtime.ts owns the JSON codec instantiation.',
    );
  };
}

export const pgJsonLegacyCodec: ParameterizedCodecDescriptor<JsonLegacyParams> = {
  codecId: PG_JSON_CODEC_ID,
  paramsSchema: jsonLegacyParamsSchema,
  renderOutputType: renderJsonOutputType,
  factory: jsonLegacyPlaceholderFactory,
};

export const pgJsonbLegacyCodec: ParameterizedCodecDescriptor<JsonLegacyParams> = {
  codecId: PG_JSONB_CODEC_ID,
  paramsSchema: jsonLegacyParamsSchema,
  renderOutputType: renderJsonOutputType,
  factory: jsonLegacyPlaceholderFactory,
};

/** Every Postgres parameterized codec descriptor, ready to register with the framework. */
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous descriptor registry — each entry carries its own params shape.
export const allPostgresParameterizedCodecs: ReadonlyArray<ParameterizedCodecDescriptor<any>> = [
  sqlCharCodec,
  sqlVarcharCodec,
  sqlTimestampCodec,
  pgCharCodec,
  pgVarcharCodec,
  pgNumericCodec,
  pgBitCodec,
  pgVarbitCodec,
  pgTimestampCodec,
  pgTimestamptzCodec,
  pgTimeCodec,
  pgTimetzCodec,
  pgIntervalCodec,
  pgEnumCodec,
];
