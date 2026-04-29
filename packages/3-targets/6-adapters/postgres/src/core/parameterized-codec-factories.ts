/**
 * Curried higher-order codec factories for Postgres parameterized codecs.
 *
 * Each function produces a `(ctx) => Codec<…, BrandedJs<Param>>` keyed by the
 * literal type parameter so the no-emit `FieldOutputType` can derive the
 * column's resolved JS type as the brand (e.g. `Char<36>`, `Numeric<10, 2>`).
 *
 * All Postgres parameterized codecs are stateless at the per-instance level
 * (the wire format is the same regardless of length / precision); the closures
 * exist only to satisfy the higher-order shape and to give the no-emit type
 * resolver `(ctx) => Codec<…>` to read off.
 *
 * The framework-registration descriptors at `./codec-descriptors.ts` reuse
 * these factories via `(params) => factoryFor(params)`; the column-author
 * surfaces at `../exports/column-types.ts` reuse them via `type:
 * factoryFor(arg)`. See [ADR 205](../../../../../../docs/architecture%20docs/adrs/ADR%20205%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).
 */

import type { JsonValue } from '@prisma-next/contract/types';
import type { Codec, Ctx } from '@prisma-next/framework-components/codec';
import type {
  Bit,
  Char,
  Interval,
  Numeric,
  Time,
  Timestamp,
  Timestamptz,
  Timetz,
  VarBit,
  Varchar,
} from '../exports/codec-types';
import {
  PG_BIT_CODEC_ID,
  PG_CHAR_CODEC_ID,
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
} from './codec-ids';

// ── Char / Varchar / Bit / VarBit (length-parameterized, string-shaped) ───

export type CharCodec<N extends number> = Codec<
  typeof PG_CHAR_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  Char<N>
>;

export function charCodecForLength<N extends number>(_length: N): (ctx: Ctx) => CharCodec<N> {
  return (_ctx) => ({
    id: PG_CHAR_CODEC_ID,
    targetTypes: ['character'] as const,
    traits: ['equality', 'order', 'textual'] as const,
    encode: (value: Char<N>) => value,
    // wire is a fixed-length character string; trim trailing pad to match the
    // pre-M4 sql/char codec's decode (`wire.trimEnd()`).
    decode: (wire: string) => wire.trimEnd() as Char<N>,
    encodeJson: (value: Char<N>) => value as unknown as JsonValue,
    decodeJson: (json: JsonValue) => json as unknown as Char<N>,
  });
}

export type VarcharCodec<N extends number> = Codec<
  typeof PG_VARCHAR_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  Varchar<N>
>;

export function varcharCodecForLength<N extends number>(_length: N): (ctx: Ctx) => VarcharCodec<N> {
  return (_ctx) => ({
    id: PG_VARCHAR_CODEC_ID,
    targetTypes: ['character varying'] as const,
    traits: ['equality', 'order', 'textual'] as const,
    encode: (value: Varchar<N>) => value,
    decode: (wire: string) => wire as Varchar<N>,
    encodeJson: (value: Varchar<N>) => value as unknown as JsonValue,
    decodeJson: (json: JsonValue) => json as unknown as Varchar<N>,
  });
}

export type BitCodec<N extends number> = Codec<
  typeof PG_BIT_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Bit<N>
>;

export function bitCodecForLength<N extends number>(_length: N): (ctx: Ctx) => BitCodec<N> {
  return (_ctx) => ({
    id: PG_BIT_CODEC_ID,
    targetTypes: ['bit'] as const,
    traits: ['equality', 'order'] as const,
    encode: (value: Bit<N>) => value,
    decode: (wire: string) => wire as Bit<N>,
    encodeJson: (value: Bit<N>) => value as unknown as JsonValue,
    decodeJson: (json: JsonValue) => json as unknown as Bit<N>,
  });
}

export type VarBitCodec<N extends number> = Codec<
  typeof PG_VARBIT_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  VarBit<N>
>;

export function varbitCodecForLength<N extends number>(_length: N): (ctx: Ctx) => VarBitCodec<N> {
  return (_ctx) => ({
    id: PG_VARBIT_CODEC_ID,
    targetTypes: ['bit varying'] as const,
    traits: ['equality', 'order'] as const,
    encode: (value: VarBit<N>) => value,
    decode: (wire: string) => wire as VarBit<N>,
    encodeJson: (value: VarBit<N>) => value as unknown as JsonValue,
    decodeJson: (json: JsonValue) => json as unknown as VarBit<N>,
  });
}

// ── Numeric (precision + scale) ──────────────────────────────────────────

export type NumericCodec<P extends number, S extends number | undefined = undefined> = Codec<
  typeof PG_NUMERIC_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  string,
  Numeric<P, S>
>;

export function numericCodecForParams<P extends number, S extends number | undefined = undefined>(
  _precision: P,
  _scale?: S,
): (ctx: Ctx) => NumericCodec<P, S> {
  return (_ctx) => ({
    id: PG_NUMERIC_CODEC_ID,
    targetTypes: ['numeric', 'decimal'] as const,
    traits: ['equality', 'order', 'numeric'] as const,
    encode: (value: Numeric<P, S>) => value,
    decode: (wire: string | number) => {
      const text = typeof wire === 'number' ? String(wire) : wire;
      return text as Numeric<P, S>;
    },
    encodeJson: (value: Numeric<P, S>) => value as unknown as JsonValue,
    decodeJson: (json: JsonValue) => json as unknown as Numeric<P, S>,
  });
}

// ── Timestamp / Timestamptz / Time / Timetz / Interval (precision-only) ──

export type TimestampCodec<P extends number | undefined = undefined> = Codec<
  typeof PG_TIMESTAMP_CODEC_ID,
  readonly ['equality', 'order'],
  string | Date,
  Timestamp<P>
>;

function normalizeTimestamp(wire: string | Date): string {
  if (wire instanceof Date) return wire.toISOString();
  return wire;
}

export function timestampCodecForPrecision<P extends number | undefined>(
  _precision: P,
): (ctx: Ctx) => TimestampCodec<P> {
  return (_ctx) => ({
    id: PG_TIMESTAMP_CODEC_ID,
    targetTypes: ['timestamp'] as const,
    traits: ['equality', 'order'] as const,
    encode: (value: Timestamp<P>) => value as unknown as string,
    decode: (wire: string | Date) => normalizeTimestamp(wire) as Timestamp<P>,
    encodeJson: (value: Timestamp<P>) => value as unknown as JsonValue,
    decodeJson: (json: JsonValue) => json as unknown as Timestamp<P>,
  });
}

export type TimestamptzCodec<P extends number | undefined = undefined> = Codec<
  typeof PG_TIMESTAMPTZ_CODEC_ID,
  readonly ['equality', 'order'],
  string | Date,
  Timestamptz<P>
>;

export function timestamptzCodecForPrecision<P extends number | undefined>(
  _precision: P,
): (ctx: Ctx) => TimestamptzCodec<P> {
  return (_ctx) => ({
    id: PG_TIMESTAMPTZ_CODEC_ID,
    targetTypes: ['timestamptz'] as const,
    traits: ['equality', 'order'] as const,
    encode: (value: Timestamptz<P>) => value as unknown as string,
    decode: (wire: string | Date) => normalizeTimestamp(wire) as Timestamptz<P>,
    encodeJson: (value: Timestamptz<P>) => value as unknown as JsonValue,
    decodeJson: (json: JsonValue) => json as unknown as Timestamptz<P>,
  });
}

export type TimeCodec<P extends number | undefined = undefined> = Codec<
  typeof PG_TIME_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Time<P>
>;

export function timeCodecForPrecision<P extends number | undefined>(
  _precision: P,
): (ctx: Ctx) => TimeCodec<P> {
  return (_ctx) => ({
    id: PG_TIME_CODEC_ID,
    targetTypes: ['time'] as const,
    traits: ['equality', 'order'] as const,
    encode: (value: Time<P>) => value as unknown as string,
    decode: (wire: string) => wire as Time<P>,
    encodeJson: (value: Time<P>) => value as unknown as JsonValue,
    decodeJson: (json: JsonValue) => json as unknown as Time<P>,
  });
}

export type TimetzCodec<P extends number | undefined = undefined> = Codec<
  typeof PG_TIMETZ_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Timetz<P>
>;

export function timetzCodecForPrecision<P extends number | undefined>(
  _precision: P,
): (ctx: Ctx) => TimetzCodec<P> {
  return (_ctx) => ({
    id: PG_TIMETZ_CODEC_ID,
    targetTypes: ['timetz'] as const,
    traits: ['equality', 'order'] as const,
    encode: (value: Timetz<P>) => value as unknown as string,
    decode: (wire: string) => wire as Timetz<P>,
    encodeJson: (value: Timetz<P>) => value as unknown as JsonValue,
    decodeJson: (json: JsonValue) => json as unknown as Timetz<P>,
  });
}

export type IntervalCodec<P extends number | undefined = undefined> = Codec<
  typeof PG_INTERVAL_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Interval<P>
>;

export function intervalCodecForPrecision<P extends number | undefined>(
  _precision: P,
): (ctx: Ctx) => IntervalCodec<P> {
  return (_ctx) => ({
    id: PG_INTERVAL_CODEC_ID,
    targetTypes: ['interval'] as const,
    traits: ['equality', 'order'] as const,
    encode: (value: Interval<P>) => value as unknown as string,
    decode: (wire: string | Record<string, unknown>) => {
      if (typeof wire === 'string') return wire as Interval<P>;
      return JSON.stringify(wire) as Interval<P>;
    },
    encodeJson: (value: Interval<P>) => value as unknown as JsonValue,
    decodeJson: (json: JsonValue) => json as unknown as Interval<P>,
  });
}

// ── JSON / JSONB ─────────────────────────────────────────────────────────
//
// The schema-typed `json(schema)` factory ships separately at
// `../codecs/json-factory.ts` (M3) — that one carries an `InferOutput<S>` Js
// slot and a runtime validator. The factories below are the no-schema
// variants that today's `jsonColumn` / `jsonbColumn` static descriptors
// resolve to; they preserve the JSON identity (no validation, JsonValue Js).

export type PgJsonValueCodec<Id extends typeof PG_JSON_CODEC_ID | typeof PG_JSONB_CODEC_ID> = Codec<
  Id,
  readonly ['equality'],
  string | JsonValue,
  JsonValue
>;

function buildJsonValueCodec<Id extends typeof PG_JSON_CODEC_ID | typeof PG_JSONB_CODEC_ID>(
  id: Id,
  nativeType: 'json' | 'jsonb',
): (ctx: Ctx) => PgJsonValueCodec<Id> {
  return (_ctx) => ({
    id,
    targetTypes: [nativeType] as const,
    traits: ['equality'] as const,
    encode: (value: JsonValue) => JSON.stringify(value),
    decode: (wire: string | JsonValue) => (typeof wire === 'string' ? JSON.parse(wire) : wire),
    encodeJson: (value: JsonValue) => value,
    decodeJson: (json: JsonValue) => json,
  });
}

export const pgJsonValueFactory = buildJsonValueCodec(PG_JSON_CODEC_ID, 'json');
export const pgJsonbValueFactory = buildJsonValueCodec(PG_JSONB_CODEC_ID, 'jsonb');
