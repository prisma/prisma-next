/**
 * Framework-registration descriptors for every Postgres parameterized codec.
 *
 * Each descriptor pairs a codec id with a curried higher-order codec factory
 * (from `../core/parameterized-codec-factories.ts`), a Standard-Schema params
 * validator, and an emit-path renderer. The renderer logic mirrors the brand
 * each codec carries (`Char<N>`, `Numeric<P, S>`, `Timestamp<P>`, …) so the
 * emit path stamps the same TypeScript source the no-emit resolver derives
 * from the curried factory's return type. See [ADR 205](../../../../../../docs/architecture%20docs/adrs/ADR%20205%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).
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
  traits: ['equality', 'order', 'textual'] as const,
  targetTypes: ['char'] as const,
  paramsSchema: lengthParamsSchema,
  renderOutputType: (params) => renderLength('Char', params),
  factory: ({ length }) => charCodecForLength(length),
};

export const sqlVarcharCodec: ParameterizedCodecDescriptor<{ readonly length: number }> = {
  codecId: SQL_VARCHAR_CODEC_ID,
  traits: ['equality', 'order', 'textual'] as const,
  targetTypes: ['varchar'] as const,
  paramsSchema: lengthParamsSchema,
  renderOutputType: (params) => renderLength('Varchar', params),
  factory: ({ length }) => varcharCodecForLength(length),
};

export const pgCharCodec: ParameterizedCodecDescriptor<{ readonly length: number }> = {
  codecId: PG_CHAR_CODEC_ID,
  traits: ['equality', 'order', 'textual'] as const,
  targetTypes: ['character'] as const,
  paramsSchema: lengthParamsSchema,
  renderOutputType: (params) => renderLength('Char', params),
  factory: ({ length }) => charCodecForLength(length),
};

export const pgVarcharCodec: ParameterizedCodecDescriptor<{ readonly length: number }> = {
  codecId: PG_VARCHAR_CODEC_ID,
  traits: ['equality', 'order', 'textual'] as const,
  targetTypes: ['character varying'] as const,
  paramsSchema: lengthParamsSchema,
  renderOutputType: (params) => renderLength('Varchar', params),
  factory: ({ length }) => varcharCodecForLength(length),
};

// ── Bit / VarBit ─────────────────────────────────────────────────────────

export const pgBitCodec: ParameterizedCodecDescriptor<{ readonly length: number }> = {
  codecId: PG_BIT_CODEC_ID,
  traits: ['equality', 'order'] as const,
  targetTypes: ['bit'] as const,
  paramsSchema: lengthParamsSchema,
  renderOutputType: (params) => renderLength('Bit', params),
  factory: ({ length }) => bitCodecForLength(length),
};

export const pgVarbitCodec: ParameterizedCodecDescriptor<{ readonly length: number }> = {
  codecId: PG_VARBIT_CODEC_ID,
  traits: ['equality', 'order'] as const,
  targetTypes: ['bit varying'] as const,
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
  traits: ['equality', 'order', 'numeric'] as const,
  targetTypes: ['numeric', 'decimal'] as const,
  paramsSchema: numericParamsSchema,
  renderOutputType: ({ precision, scale }) =>
    typeof scale === 'number' ? `Numeric<${precision}, ${scale}>` : `Numeric<${precision}>`,
  factory: ({ precision, scale }) => numericCodecForParams(precision, scale),
};

// ── Timestamp / Timestamptz / Time / Timetz / Interval ───────────────────

export const sqlTimestampCodec: ParameterizedCodecDescriptor<{ readonly precision?: number }> = {
  codecId: SQL_TIMESTAMP_CODEC_ID,
  traits: ['equality', 'order'] as const,
  targetTypes: ['timestamp'] as const,
  paramsSchema: precisionParamsSchema,
  renderOutputType: (params) => renderPrecision('Timestamp', params),
  factory: ({ precision }) => timestampCodecForPrecision(precision),
};

export const pgTimestampCodec: ParameterizedCodecDescriptor<{ readonly precision?: number }> = {
  codecId: PG_TIMESTAMP_CODEC_ID,
  traits: ['equality', 'order'] as const,
  targetTypes: ['timestamp'] as const,
  paramsSchema: precisionParamsSchema,
  renderOutputType: (params) => renderPrecision('Timestamp', params),
  factory: ({ precision }) => timestampCodecForPrecision(precision),
};

export const pgTimestamptzCodec: ParameterizedCodecDescriptor<{ readonly precision?: number }> = {
  codecId: PG_TIMESTAMPTZ_CODEC_ID,
  traits: ['equality', 'order'] as const,
  targetTypes: ['timestamptz'] as const,
  paramsSchema: precisionParamsSchema,
  renderOutputType: (params) => renderPrecision('Timestamptz', params),
  factory: ({ precision }) => timestamptzCodecForPrecision(precision),
};

export const pgTimeCodec: ParameterizedCodecDescriptor<{ readonly precision?: number }> = {
  codecId: PG_TIME_CODEC_ID,
  traits: ['equality', 'order'] as const,
  targetTypes: ['time'] as const,
  paramsSchema: precisionParamsSchema,
  renderOutputType: (params) => renderPrecision('Time', params),
  factory: ({ precision }) => timeCodecForPrecision(precision),
};

export const pgTimetzCodec: ParameterizedCodecDescriptor<{ readonly precision?: number }> = {
  codecId: PG_TIMETZ_CODEC_ID,
  traits: ['equality', 'order'] as const,
  targetTypes: ['timetz'] as const,
  paramsSchema: precisionParamsSchema,
  renderOutputType: (params) => renderPrecision('Timetz', params),
  factory: ({ precision }) => timetzCodecForPrecision(precision),
};

export const pgIntervalCodec: ParameterizedCodecDescriptor<{ readonly precision?: number }> = {
  codecId: PG_INTERVAL_CODEC_ID,
  traits: ['equality', 'order'] as const,
  targetTypes: ['interval'] as const,
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
  traits: ['equality', 'order'] as const,
  targetTypes: ['enum'] as const,
  paramsSchema: enumParamsSchema,
  renderOutputType: ({ values }) =>
    values
      .map((value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
      .join(' | '),
  // The enum codec is registered through the legacy codec registry today
  // (see `core/codecs.ts`); the descriptor exists only to provide
  // `renderOutputType` to the emitter. The factory placeholder satisfies the
  // descriptor shape; M4's emit path never invokes it.
  factory: enumPlaceholderFactory,
};

// JSON / JSONB columns with schema validation are handled by per-library
// extension packages (e.g. `@prisma-next/extension-arktype-json`); they
// register their own `arktype/json@1` (etc.) parameterized codec descriptor
// with the control stack and the runtime. The postgres adapter ships only
// the non-parameterized `pg/json@1` and `pg/jsonb@1` raw-JSONB codecs (in
// `../core/codecs.ts`), used by the bare `jsonColumn` / `jsonbColumn` /
// `json()` / `jsonb()` surfaces in `../exports/column-types.ts`.

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
