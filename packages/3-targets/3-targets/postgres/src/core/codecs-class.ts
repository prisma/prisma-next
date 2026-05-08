/**
 * Class-based form of the native Postgres target codecs (TML-2357 M0
 * Phase B2). Mirrors the SQL base codec class form added in Phase B1
 * (`packages/2-sql/4-lanes/relational-core/src/ast/sql-codecs-class.ts`).
 *
 * Each codec ships as three artifacts:
 *
 * 1. A `PgXCodec` class extending {@link CodecImpl} that wraps the
 *    module-level encode/decode/encodeJson/decodeJson constants exported
 *    from `codecs.ts` (the single source of truth for non-trivial
 *    runtime conversions; trivial identity passthroughs are inlined).
 * 2. A `PgXDescriptor` class extending {@link CodecDescriptorImpl}
 *    declaring the codec id, traits, target types, params schema, meta,
 *    and (where applicable) the emit-path `renderOutputType`.
 * 3. A per-codec column helper (`pgXColumn`) that calls
 *    `descriptor.factory(...)` directly and packages the result into a
 *    {@link ColumnSpec} via the framework {@link column} packager. The
 *    helper is tied to its descriptor with `satisfies ColumnHelperFor`
 *    (and `ColumnHelperForStrict` where the resolved codec type is
 *    well-defined).
 *
 * After TML-2357 M0 Phase C this is the canonical source of Postgres codec
 * metadata and runtime behaviour — the legacy `mkCodec` / `defineCodec`
 * carriers (and the parallel `byScalar`/`codecDescriptorDefinitions`/
 * `codecDescriptorList` collection exports) retired with the deletion
 * sweep.
 *
 * Audit (parameterized codecs): every parameterized codec in this file
 * is **parameter-stateless** — the params (`length`, `precision`,
 * `precision`+`scale`, `values`) only inform the emit-path
 * `renderOutputType` renderer or stay as JSON metadata. None of the
 * runtime encode/decode/encodeJson/decodeJson conversions thread params
 * into their behavior, so each `factory(_params)` returns a fresh
 * codec constructed solely from `this` (the descriptor).
 */

import { arktypeParamsSchema, type JsonValue } from '@prisma-next/contract/types';
import {
  type AnyCodecDescriptor,
  type CodecCallContext,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
  voidParamsSchema,
} from '@prisma-next/framework-components/codec';
import {
  type ExtractCodecTypes,
  SqlCharCodec,
  SqlFloatCodec,
  SqlIntCodec,
  SqlVarcharCodec,
  sqlCharDescriptorClass,
  sqlFloatDescriptorClass,
  sqlIntDescriptorClass,
  sqlTextDescriptorClass,
  sqlTimestampDescriptorClass,
  sqlVarcharDescriptorClass,
} from '@prisma-next/sql-relational-core/ast';
import type { StandardSchemaV1 } from '@standard-schema/spec';
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
import {
  pgEnumRenderOutputType,
  pgIntervalDecode,
  pgJsonbDecode,
  pgJsonbEncode,
  pgJsonDecode,
  pgJsonEncode,
  pgNumericDecode,
  pgNumericRenderOutputType,
  pgTimestampDecodeJson,
  pgTimestampEncodeJson,
  pgTimestamptzDecodeJson,
  pgTimestamptzEncodeJson,
  renderLength,
  renderPrecision,
} from './codecs';

// ---------------------------------------------------------------------------
// Params schemas + types. Reconstructed locally so the legacy `codecs.ts`
// content stays untouched. The validators are JSON-boundary metadata,
// not runtime conversion behaviour.
// ---------------------------------------------------------------------------

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

type LengthParams = { readonly length?: number };
type PrecisionParams = { readonly precision?: number };
type NumericParams = { readonly precision: number; readonly scale?: number };
type EnumParams = { readonly values?: readonly unknown[] };

const PG_TEXT_META = { db: { sql: { postgres: { nativeType: 'text' } } } } as const;
const PG_INT4_META = { db: { sql: { postgres: { nativeType: 'integer' } } } } as const;
const PG_INT2_META = { db: { sql: { postgres: { nativeType: 'smallint' } } } } as const;
const PG_INT8_META = { db: { sql: { postgres: { nativeType: 'bigint' } } } } as const;
const PG_FLOAT4_META = { db: { sql: { postgres: { nativeType: 'real' } } } } as const;
const PG_FLOAT8_META = { db: { sql: { postgres: { nativeType: 'double precision' } } } } as const;
const PG_NUMERIC_META = { db: { sql: { postgres: { nativeType: 'numeric' } } } } as const;
const PG_TIMESTAMP_META = {
  db: { sql: { postgres: { nativeType: 'timestamp without time zone' } } },
} as const;
const PG_TIMESTAMPTZ_META = {
  db: { sql: { postgres: { nativeType: 'timestamp with time zone' } } },
} as const;
const PG_TIME_META = { db: { sql: { postgres: { nativeType: 'time' } } } } as const;
const PG_TIMETZ_META = { db: { sql: { postgres: { nativeType: 'timetz' } } } } as const;
const PG_BOOL_META = { db: { sql: { postgres: { nativeType: 'boolean' } } } } as const;
const PG_BIT_META = { db: { sql: { postgres: { nativeType: 'bit' } } } } as const;
const PG_VARBIT_META = { db: { sql: { postgres: { nativeType: 'bit varying' } } } } as const;
const PG_BYTEA_META = { db: { sql: { postgres: { nativeType: 'bytea' } } } } as const;
const PG_INTERVAL_META = { db: { sql: { postgres: { nativeType: 'interval' } } } } as const;
const PG_JSON_META = { db: { sql: { postgres: { nativeType: 'json' } } } } as const;
const PG_JSONB_META = { db: { sql: { postgres: { nativeType: 'jsonb' } } } } as const;

// ---------------------------------------------------------------------------
// pg/text@1 — non-parameterized, JSON-safe (string).
// ---------------------------------------------------------------------------

export class PgTextCodec extends CodecImpl<
  typeof PG_TEXT_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

export class PgTextDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = PG_TEXT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly meta = PG_TEXT_META;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgTextCodec {
    return () => new PgTextCodec(this);
  }
}

export const pgTextDescriptorClass = new PgTextDescriptor();

export const pgTextColumn = () =>
  column(pgTextDescriptorClass.factory(), pgTextDescriptorClass.codecId, undefined, 'text');

pgTextColumn satisfies ColumnHelperFor<PgTextDescriptor>;
pgTextColumn satisfies ColumnHelperForStrict<PgTextDescriptor>;

// ---------------------------------------------------------------------------
// pg/int4@1 — non-parameterized, JSON-safe (number).
// ---------------------------------------------------------------------------

export class PgInt4Codec extends CodecImpl<
  typeof PG_INT4_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
> {
  async encode(value: number, _ctx: CodecCallContext): Promise<number> {
    return value;
  }
  async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
    return wire;
  }
  encodeJson(value: number): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): number {
    return json as number;
  }
}

export class PgInt4Descriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = PG_INT4_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['int4'] as const;
  override readonly meta = PG_INT4_META;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgInt4Codec {
    return () => new PgInt4Codec(this);
  }
}

export const pgInt4DescriptorClass = new PgInt4Descriptor();

export const pgInt4Column = () =>
  column(pgInt4DescriptorClass.factory(), pgInt4DescriptorClass.codecId, undefined, 'int4');

pgInt4Column satisfies ColumnHelperFor<PgInt4Descriptor>;
pgInt4Column satisfies ColumnHelperForStrict<PgInt4Descriptor>;

// ---------------------------------------------------------------------------
// pg/int2@1 — non-parameterized, JSON-safe (number).
// ---------------------------------------------------------------------------

export class PgInt2Codec extends CodecImpl<
  typeof PG_INT2_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
> {
  async encode(value: number, _ctx: CodecCallContext): Promise<number> {
    return value;
  }
  async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
    return wire;
  }
  encodeJson(value: number): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): number {
    return json as number;
  }
}

export class PgInt2Descriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = PG_INT2_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['int2'] as const;
  override readonly meta = PG_INT2_META;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgInt2Codec {
    return () => new PgInt2Codec(this);
  }
}

export const pgInt2DescriptorClass = new PgInt2Descriptor();

export const pgInt2Column = () =>
  column(pgInt2DescriptorClass.factory(), pgInt2DescriptorClass.codecId, undefined, 'int2');

pgInt2Column satisfies ColumnHelperFor<PgInt2Descriptor>;
pgInt2Column satisfies ColumnHelperForStrict<PgInt2Descriptor>;

// ---------------------------------------------------------------------------
// pg/int8@1 — non-parameterized, JSON-safe (number).
// ---------------------------------------------------------------------------

export class PgInt8Codec extends CodecImpl<
  typeof PG_INT8_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
> {
  async encode(value: number, _ctx: CodecCallContext): Promise<number> {
    return value;
  }
  async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
    return wire;
  }
  encodeJson(value: number): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): number {
    return json as number;
  }
}

export class PgInt8Descriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = PG_INT8_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['int8'] as const;
  override readonly meta = PG_INT8_META;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgInt8Codec {
    return () => new PgInt8Codec(this);
  }
}

export const pgInt8DescriptorClass = new PgInt8Descriptor();

export const pgInt8Column = () =>
  column(pgInt8DescriptorClass.factory(), pgInt8DescriptorClass.codecId, undefined, 'int8');

pgInt8Column satisfies ColumnHelperFor<PgInt8Descriptor>;
pgInt8Column satisfies ColumnHelperForStrict<PgInt8Descriptor>;

// ---------------------------------------------------------------------------
// pg/float4@1 — non-parameterized, JSON-safe (number).
// ---------------------------------------------------------------------------

export class PgFloat4Codec extends CodecImpl<
  typeof PG_FLOAT4_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
> {
  async encode(value: number, _ctx: CodecCallContext): Promise<number> {
    return value;
  }
  async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
    return wire;
  }
  encodeJson(value: number): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): number {
    return json as number;
  }
}

export class PgFloat4Descriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = PG_FLOAT4_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['float4'] as const;
  override readonly meta = PG_FLOAT4_META;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgFloat4Codec {
    return () => new PgFloat4Codec(this);
  }
}

export const pgFloat4DescriptorClass = new PgFloat4Descriptor();

export const pgFloat4Column = () =>
  column(pgFloat4DescriptorClass.factory(), pgFloat4DescriptorClass.codecId, undefined, 'float4');

pgFloat4Column satisfies ColumnHelperFor<PgFloat4Descriptor>;
pgFloat4Column satisfies ColumnHelperForStrict<PgFloat4Descriptor>;

// ---------------------------------------------------------------------------
// pg/float8@1 — non-parameterized, JSON-safe (number).
// ---------------------------------------------------------------------------

export class PgFloat8Codec extends CodecImpl<
  typeof PG_FLOAT8_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
> {
  async encode(value: number, _ctx: CodecCallContext): Promise<number> {
    return value;
  }
  async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
    return wire;
  }
  encodeJson(value: number): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): number {
    return json as number;
  }
}

export class PgFloat8Descriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = PG_FLOAT8_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['float8'] as const;
  override readonly meta = PG_FLOAT8_META;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgFloat8Codec {
    return () => new PgFloat8Codec(this);
  }
}

export const pgFloat8DescriptorClass = new PgFloat8Descriptor();

export const pgFloat8Column = () =>
  column(pgFloat8DescriptorClass.factory(), pgFloat8DescriptorClass.codecId, undefined, 'float8');

pgFloat8Column satisfies ColumnHelperFor<PgFloat8Descriptor>;
pgFloat8Column satisfies ColumnHelperForStrict<PgFloat8Descriptor>;

// ---------------------------------------------------------------------------
// pg/bool@1 — non-parameterized, JSON-safe (boolean).
// ---------------------------------------------------------------------------

export class PgBoolCodec extends CodecImpl<
  typeof PG_BOOL_CODEC_ID,
  readonly ['equality', 'boolean'],
  boolean,
  boolean
> {
  async encode(value: boolean, _ctx: CodecCallContext): Promise<boolean> {
    return value;
  }
  async decode(wire: boolean, _ctx: CodecCallContext): Promise<boolean> {
    return wire;
  }
  encodeJson(value: boolean): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): boolean {
    return json as boolean;
  }
}

export class PgBoolDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = PG_BOOL_CODEC_ID;
  override readonly traits = ['equality', 'boolean'] as const;
  override readonly targetTypes = ['bool'] as const;
  override readonly meta = PG_BOOL_META;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgBoolCodec {
    return () => new PgBoolCodec(this);
  }
}

export const pgBoolDescriptorClass = new PgBoolDescriptor();

export const pgBoolColumn = () =>
  column(pgBoolDescriptorClass.factory(), pgBoolDescriptorClass.codecId, undefined, 'bool');

pgBoolColumn satisfies ColumnHelperFor<PgBoolDescriptor>;
pgBoolColumn satisfies ColumnHelperForStrict<PgBoolDescriptor>;

// ---------------------------------------------------------------------------
// pg/numeric@1 — precision/scale-parameterized, JSON-safe (string). Wire
// accepts string|number; encode passes through, decode coerces number to
// string. Params (`precision`, `scale`) only inform the emit-path
// renderer; the codec is parameter-stateless.
// ---------------------------------------------------------------------------

export class PgNumericCodec extends CodecImpl<
  typeof PG_NUMERIC_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  string | number,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string | number, _ctx: CodecCallContext): Promise<string> {
    return pgNumericDecode(wire);
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

export class PgNumericDescriptor extends CodecDescriptorImpl<NumericParams> {
  override readonly codecId = PG_NUMERIC_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['numeric', 'decimal'] as const;
  override readonly meta = PG_NUMERIC_META;
  override readonly paramsSchema = arktypeParamsSchema<NumericParams>(numericParamsSchema);
  override renderOutputType(params: NumericParams): string | undefined {
    return pgNumericRenderOutputType(params);
  }
  override factory(_params: NumericParams): (ctx: CodecInstanceContext) => PgNumericCodec {
    return () => new PgNumericCodec(this);
  }
}

export const pgNumericDescriptorClass = new PgNumericDescriptor();

export const pgNumericColumn = (params: NumericParams) =>
  column(
    pgNumericDescriptorClass.factory(params),
    pgNumericDescriptorClass.codecId,
    params,
    'numeric',
  );

pgNumericColumn satisfies ColumnHelperFor<PgNumericDescriptor>;
pgNumericColumn satisfies ColumnHelperForStrict<PgNumericDescriptor>;

// ---------------------------------------------------------------------------
// pg/timestamp@1 — precision-parameterized, NOT JSON-safe (Date). Custom
// encodeJson/decodeJson round-trip through ISO-8601 strings. Params are
// JSON-only metadata; the codec is parameter-stateless (precision only
// informs `renderOutputType` for the contract.d.ts emit path).
// ---------------------------------------------------------------------------

export class PgTimestampCodec extends CodecImpl<
  typeof PG_TIMESTAMP_CODEC_ID,
  readonly ['equality', 'order'],
  Date,
  Date
> {
  async encode(value: Date, _ctx: CodecCallContext): Promise<Date> {
    return value;
  }
  async decode(wire: Date, _ctx: CodecCallContext): Promise<Date> {
    return wire;
  }
  encodeJson(value: Date): JsonValue {
    return pgTimestampEncodeJson(value);
  }
  decodeJson(json: JsonValue): Date {
    return pgTimestampDecodeJson(json);
  }
}

export class PgTimestampDescriptor extends CodecDescriptorImpl<PrecisionParams> {
  override readonly codecId = PG_TIMESTAMP_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['timestamp'] as const;
  override readonly meta = PG_TIMESTAMP_META;
  override readonly paramsSchema = arktypeParamsSchema<PrecisionParams>(precisionParamsSchema);
  override renderOutputType(params: PrecisionParams): string | undefined {
    return renderPrecision('Timestamp', params as Record<string, unknown>);
  }
  override factory(_params: PrecisionParams): (ctx: CodecInstanceContext) => PgTimestampCodec {
    return () => new PgTimestampCodec(this);
  }
}

export const pgTimestampDescriptorClass = new PgTimestampDescriptor();

export const pgTimestampColumn = (params: PrecisionParams = {}) =>
  column(
    pgTimestampDescriptorClass.factory(params),
    pgTimestampDescriptorClass.codecId,
    params,
    'timestamp',
  );

pgTimestampColumn satisfies ColumnHelperFor<PgTimestampDescriptor>;
pgTimestampColumn satisfies ColumnHelperForStrict<PgTimestampDescriptor>;

// ---------------------------------------------------------------------------
// pg/timestamptz@1 — same shape as pg/timestamp@1 with timezone semantics.
// ---------------------------------------------------------------------------

export class PgTimestamptzCodec extends CodecImpl<
  typeof PG_TIMESTAMPTZ_CODEC_ID,
  readonly ['equality', 'order'],
  Date,
  Date
> {
  async encode(value: Date, _ctx: CodecCallContext): Promise<Date> {
    return value;
  }
  async decode(wire: Date, _ctx: CodecCallContext): Promise<Date> {
    return wire;
  }
  encodeJson(value: Date): JsonValue {
    return pgTimestamptzEncodeJson(value);
  }
  decodeJson(json: JsonValue): Date {
    return pgTimestamptzDecodeJson(json);
  }
}

export class PgTimestamptzDescriptor extends CodecDescriptorImpl<PrecisionParams> {
  override readonly codecId = PG_TIMESTAMPTZ_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['timestamptz'] as const;
  override readonly meta = PG_TIMESTAMPTZ_META;
  override readonly paramsSchema = arktypeParamsSchema<PrecisionParams>(precisionParamsSchema);
  override renderOutputType(params: PrecisionParams): string | undefined {
    return renderPrecision('Timestamptz', params as Record<string, unknown>);
  }
  override factory(_params: PrecisionParams): (ctx: CodecInstanceContext) => PgTimestamptzCodec {
    return () => new PgTimestamptzCodec(this);
  }
}

export const pgTimestamptzDescriptorClass = new PgTimestamptzDescriptor();

export const pgTimestamptzColumn = (params: PrecisionParams = {}) =>
  column(
    pgTimestamptzDescriptorClass.factory(params),
    pgTimestamptzDescriptorClass.codecId,
    params,
    'timestamptz',
  );

pgTimestamptzColumn satisfies ColumnHelperFor<PgTimestamptzDescriptor>;
pgTimestamptzColumn satisfies ColumnHelperForStrict<PgTimestamptzDescriptor>;

// ---------------------------------------------------------------------------
// pg/time@1 — precision-parameterized, JSON-safe (string).
// ---------------------------------------------------------------------------

export class PgTimeCodec extends CodecImpl<
  typeof PG_TIME_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

export class PgTimeDescriptor extends CodecDescriptorImpl<PrecisionParams> {
  override readonly codecId = PG_TIME_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['time'] as const;
  override readonly meta = PG_TIME_META;
  override readonly paramsSchema = arktypeParamsSchema<PrecisionParams>(precisionParamsSchema);
  override renderOutputType(params: PrecisionParams): string | undefined {
    return renderPrecision('Time', params as Record<string, unknown>);
  }
  override factory(_params: PrecisionParams): (ctx: CodecInstanceContext) => PgTimeCodec {
    return () => new PgTimeCodec(this);
  }
}

export const pgTimeDescriptorClass = new PgTimeDescriptor();

export const pgTimeColumn = (params: PrecisionParams = {}) =>
  column(pgTimeDescriptorClass.factory(params), pgTimeDescriptorClass.codecId, params, 'time');

pgTimeColumn satisfies ColumnHelperFor<PgTimeDescriptor>;
pgTimeColumn satisfies ColumnHelperForStrict<PgTimeDescriptor>;

// ---------------------------------------------------------------------------
// pg/timetz@1 — precision-parameterized, JSON-safe (string).
// ---------------------------------------------------------------------------

export class PgTimetzCodec extends CodecImpl<
  typeof PG_TIMETZ_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

export class PgTimetzDescriptor extends CodecDescriptorImpl<PrecisionParams> {
  override readonly codecId = PG_TIMETZ_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['timetz'] as const;
  override readonly meta = PG_TIMETZ_META;
  override readonly paramsSchema = arktypeParamsSchema<PrecisionParams>(precisionParamsSchema);
  override renderOutputType(params: PrecisionParams): string | undefined {
    return renderPrecision('Timetz', params as Record<string, unknown>);
  }
  override factory(_params: PrecisionParams): (ctx: CodecInstanceContext) => PgTimetzCodec {
    return () => new PgTimetzCodec(this);
  }
}

export const pgTimetzDescriptorClass = new PgTimetzDescriptor();

export const pgTimetzColumn = (params: PrecisionParams = {}) =>
  column(
    pgTimetzDescriptorClass.factory(params),
    pgTimetzDescriptorClass.codecId,
    params,
    'timetz',
  );

pgTimetzColumn satisfies ColumnHelperFor<PgTimetzDescriptor>;
pgTimetzColumn satisfies ColumnHelperForStrict<PgTimetzDescriptor>;

// ---------------------------------------------------------------------------
// pg/bit@1 — length-parameterized, JSON-safe (string). Length is JSON-only
// metadata; codec is parameter-stateless.
// ---------------------------------------------------------------------------

export class PgBitCodec extends CodecImpl<
  typeof PG_BIT_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

export class PgBitDescriptor extends CodecDescriptorImpl<LengthParams> {
  override readonly codecId = PG_BIT_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['bit'] as const;
  override readonly meta = PG_BIT_META;
  override readonly paramsSchema = arktypeParamsSchema<LengthParams>(lengthParamsSchema);
  override renderOutputType(params: LengthParams): string | undefined {
    return renderLength('Bit', params as Record<string, unknown>);
  }
  override factory(_params: LengthParams): (ctx: CodecInstanceContext) => PgBitCodec {
    return () => new PgBitCodec(this);
  }
}

export const pgBitDescriptorClass = new PgBitDescriptor();

export const pgBitColumn = (params: LengthParams = {}) =>
  column(pgBitDescriptorClass.factory(params), pgBitDescriptorClass.codecId, params, 'bit');

pgBitColumn satisfies ColumnHelperFor<PgBitDescriptor>;
pgBitColumn satisfies ColumnHelperForStrict<PgBitDescriptor>;

// ---------------------------------------------------------------------------
// pg/varbit@1 — length-parameterized, JSON-safe (string).
// ---------------------------------------------------------------------------

export class PgVarbitCodec extends CodecImpl<
  typeof PG_VARBIT_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

export class PgVarbitDescriptor extends CodecDescriptorImpl<LengthParams> {
  override readonly codecId = PG_VARBIT_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['bit varying'] as const;
  override readonly meta = PG_VARBIT_META;
  override readonly paramsSchema = arktypeParamsSchema<LengthParams>(lengthParamsSchema);
  override renderOutputType(params: LengthParams): string | undefined {
    return renderLength('VarBit', params as Record<string, unknown>);
  }
  override factory(_params: LengthParams): (ctx: CodecInstanceContext) => PgVarbitCodec {
    return () => new PgVarbitCodec(this);
  }
}

export const pgVarbitDescriptorClass = new PgVarbitDescriptor();

export const pgVarbitColumn = (params: LengthParams = {}) =>
  column(
    pgVarbitDescriptorClass.factory(params),
    pgVarbitDescriptorClass.codecId,
    params,
    'bit varying',
  );

pgVarbitColumn satisfies ColumnHelperFor<PgVarbitDescriptor>;
pgVarbitColumn satisfies ColumnHelperForStrict<PgVarbitDescriptor>;

// ---------------------------------------------------------------------------
// pg/bytea@1 — non-parameterized, JSON-safe via base64 round-trip.
// ---------------------------------------------------------------------------

export class PgByteaCodec extends CodecImpl<
  typeof PG_BYTEA_CODEC_ID,
  readonly ['equality'],
  Uint8Array,
  Uint8Array
> {
  async encode(value: Uint8Array, _ctx: CodecCallContext): Promise<Uint8Array> {
    return value;
  }
  async decode(wire: Uint8Array, _ctx: CodecCallContext): Promise<Uint8Array> {
    // Postgres node drivers commonly return Buffer instances (which extend
    // Uint8Array) — normalize to a plain Uint8Array view so engine-agnostic
    // consumers don't accidentally observe Buffer-specific APIs.
    return wire instanceof Uint8Array && wire.constructor === Uint8Array
      ? wire
      : new Uint8Array(wire.buffer, wire.byteOffset, wire.byteLength);
  }
  encodeJson(value: Uint8Array): JsonValue {
    return Buffer.from(value).toString('base64');
  }
  decodeJson(json: JsonValue): Uint8Array {
    if (typeof json !== 'string') {
      throw new Error(`Expected base64 string for pg/bytea@1, got ${typeof json}`);
    }
    const decoded = Buffer.from(json, 'base64');
    if (decoded.toString('base64') !== json) {
      throw new Error(`Invalid base64 string for pg/bytea@1 (length: ${json.length})`);
    }
    return new Uint8Array(decoded);
  }
}

export class PgByteaDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = PG_BYTEA_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['bytea'] as const;
  override readonly meta = PG_BYTEA_META;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgByteaCodec {
    return () => new PgByteaCodec(this);
  }
}

export const pgByteaDescriptorClass = new PgByteaDescriptor();

export const pgByteaColumn = () =>
  column(pgByteaDescriptorClass.factory(), pgByteaDescriptorClass.codecId, undefined, 'bytea');

pgByteaColumn satisfies ColumnHelperFor<PgByteaDescriptor>;
pgByteaColumn satisfies ColumnHelperForStrict<PgByteaDescriptor>;

// ---------------------------------------------------------------------------
// pg/interval@1 — precision-parameterized, JSON-safe (string). Wire
// accepts string|object form; decode normalizes object to JSON string.
// ---------------------------------------------------------------------------

export class PgIntervalCodec extends CodecImpl<
  typeof PG_INTERVAL_CODEC_ID,
  readonly ['equality', 'order'],
  string | Record<string, unknown>,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string | Record<string, unknown>, _ctx: CodecCallContext): Promise<string> {
    return pgIntervalDecode(wire);
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

export class PgIntervalDescriptor extends CodecDescriptorImpl<PrecisionParams> {
  override readonly codecId = PG_INTERVAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['interval'] as const;
  override readonly meta = PG_INTERVAL_META;
  override readonly paramsSchema = arktypeParamsSchema<PrecisionParams>(precisionParamsSchema);
  override renderOutputType(params: PrecisionParams): string | undefined {
    return renderPrecision('Interval', params as Record<string, unknown>);
  }
  override factory(_params: PrecisionParams): (ctx: CodecInstanceContext) => PgIntervalCodec {
    return () => new PgIntervalCodec(this);
  }
}

export const pgIntervalDescriptorClass = new PgIntervalDescriptor();

export const pgIntervalColumn = (params: PrecisionParams = {}) =>
  column(
    pgIntervalDescriptorClass.factory(params),
    pgIntervalDescriptorClass.codecId,
    params,
    'interval',
  );

pgIntervalColumn satisfies ColumnHelperFor<PgIntervalDescriptor>;
pgIntervalColumn satisfies ColumnHelperForStrict<PgIntervalDescriptor>;

// ---------------------------------------------------------------------------
// pg/enum@1 — values-parameterized, JSON-safe (string). `values` is
// JSON-only metadata for the renderOutputType emit path; the codec is
// parameter-stateless. The descriptor declares a `paramsSchema` so the
// descriptor surface is consistent across all codec ids (validators are
// JSON-boundary metadata; the schema accepts optional `values`).
// ---------------------------------------------------------------------------

const enumParamsSchema = arktype({
  'values?': 'unknown[]',
});

export class PgEnumCodec extends CodecImpl<
  typeof PG_ENUM_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

export class PgEnumDescriptor extends CodecDescriptorImpl<EnumParams> {
  override readonly codecId = PG_ENUM_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['enum'] as const;
  override readonly paramsSchema = arktypeParamsSchema<EnumParams>(enumParamsSchema);
  override renderOutputType(params: EnumParams): string | undefined {
    return pgEnumRenderOutputType(params);
  }
  override factory(_params: EnumParams): (ctx: CodecInstanceContext) => PgEnumCodec {
    return () => new PgEnumCodec(this);
  }
}

export const pgEnumDescriptorClass = new PgEnumDescriptor();

export const pgEnumColumn = (params: EnumParams = {}) =>
  column(pgEnumDescriptorClass.factory(params), pgEnumDescriptorClass.codecId, params, 'enum');

pgEnumColumn satisfies ColumnHelperFor<PgEnumDescriptor>;
pgEnumColumn satisfies ColumnHelperForStrict<PgEnumDescriptor>;

// ---------------------------------------------------------------------------
// pg/json@1 — non-parameterized; wire is string|JsonValue, input is
// JsonValue. encode JSON.stringifies; decode JSON.parses if string,
// passes through otherwise.
// ---------------------------------------------------------------------------

export class PgJsonCodec extends CodecImpl<
  typeof PG_JSON_CODEC_ID,
  readonly [],
  string | JsonValue,
  JsonValue
> {
  async encode(value: JsonValue, _ctx: CodecCallContext): Promise<string> {
    return pgJsonEncode(value);
  }
  async decode(wire: string | JsonValue, _ctx: CodecCallContext): Promise<JsonValue> {
    return pgJsonDecode(wire);
  }
  encodeJson(value: JsonValue): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): JsonValue {
    return json;
  }
}

export class PgJsonDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = PG_JSON_CODEC_ID;
  override readonly traits = [] as const;
  override readonly targetTypes = ['json'] as const;
  override readonly meta = PG_JSON_META;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgJsonCodec {
    return () => new PgJsonCodec(this);
  }
}

export const pgJsonDescriptorClass = new PgJsonDescriptor();

export const pgJsonColumn = () =>
  column(pgJsonDescriptorClass.factory(), pgJsonDescriptorClass.codecId, undefined, 'json');

pgJsonColumn satisfies ColumnHelperFor<PgJsonDescriptor>;
pgJsonColumn satisfies ColumnHelperForStrict<PgJsonDescriptor>;

// ---------------------------------------------------------------------------
// pg/jsonb@1 — non-parameterized; same shape as pg/json@1 plus
// `equality` trait.
// ---------------------------------------------------------------------------

export class PgJsonbCodec extends CodecImpl<
  typeof PG_JSONB_CODEC_ID,
  readonly ['equality'],
  string | JsonValue,
  JsonValue
> {
  async encode(value: JsonValue, _ctx: CodecCallContext): Promise<string> {
    return pgJsonbEncode(value);
  }
  async decode(wire: string | JsonValue, _ctx: CodecCallContext): Promise<JsonValue> {
    return pgJsonbDecode(wire);
  }
  encodeJson(value: JsonValue): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): JsonValue {
    return json;
  }
}

export class PgJsonbDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = PG_JSONB_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['jsonb'] as const;
  override readonly meta = PG_JSONB_META;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgJsonbCodec {
    return () => new PgJsonbCodec(this);
  }
}

export const pgJsonbDescriptorClass = new PgJsonbDescriptor();

export const pgJsonbColumn = () =>
  column(pgJsonbDescriptorClass.factory(), pgJsonbDescriptorClass.codecId, undefined, 'jsonb');

pgJsonbColumn satisfies ColumnHelperFor<PgJsonbDescriptor>;
pgJsonbColumn satisfies ColumnHelperForStrict<PgJsonbDescriptor>;

// ---------------------------------------------------------------------------
// pg-alias descriptors. These four codec ids (`pg/char@1`, `pg/varchar@1`,
// `pg/int@1`, `pg/float@1`) are pure aliases over the matching SQL base
// codec (`sql/char@1`, `sql/varchar@1`, `sql/int@1`, `sql/float@1`) — they
// reuse the base encode/decode/render behaviour but expose a postgres-
// scoped codec id, distinct `targetTypes`, and per-target `meta`. The
// factories instantiate the SQL-base codec class (`SqlCharCodec` etc.)
// passing `this` (the pg-alias descriptor) so `codec.id` resolves to the
// pg-alias codec id via `CodecImpl`'s `descriptor.codecId` proxy.
// ---------------------------------------------------------------------------

const PG_CHAR_META = { db: { sql: { postgres: { nativeType: 'character' } } } } as const;
const PG_VARCHAR_META = {
  db: { sql: { postgres: { nativeType: 'character varying' } } },
} as const;
const PG_INT_META = { db: { sql: { postgres: { nativeType: 'integer' } } } } as const;
const PG_FLOAT_META = { db: { sql: { postgres: { nativeType: 'double precision' } } } } as const;

export class PgCharDescriptor extends CodecDescriptorImpl<LengthParams> {
  override readonly codecId = PG_CHAR_CODEC_ID;
  override readonly targetTypes = ['character'] as const;
  override readonly meta = PG_CHAR_META;
  override readonly traits = sqlCharDescriptorClass.traits;
  override readonly paramsSchema = sqlCharDescriptorClass.paramsSchema;
  override renderOutputType(params: LengthParams): string | undefined {
    return sqlCharDescriptorClass.renderOutputType(params);
  }
  override factory(_params: LengthParams): (ctx: CodecInstanceContext) => SqlCharCodec {
    return () => new SqlCharCodec(this);
  }
}

export const pgCharDescriptor = new PgCharDescriptor();

export const pgCharColumn = (params: LengthParams = {}) =>
  column(pgCharDescriptor.factory(params), pgCharDescriptor.codecId, params, 'character');

pgCharColumn satisfies ColumnHelperFor<PgCharDescriptor>;

export class PgVarcharDescriptor extends CodecDescriptorImpl<LengthParams> {
  override readonly codecId = PG_VARCHAR_CODEC_ID;
  override readonly targetTypes = ['character varying'] as const;
  override readonly meta = PG_VARCHAR_META;
  override readonly traits = sqlVarcharDescriptorClass.traits;
  override readonly paramsSchema = sqlVarcharDescriptorClass.paramsSchema;
  override renderOutputType(params: LengthParams): string | undefined {
    return sqlVarcharDescriptorClass.renderOutputType(params);
  }
  override factory(_params: LengthParams): (ctx: CodecInstanceContext) => SqlVarcharCodec {
    return () => new SqlVarcharCodec(this);
  }
}

export const pgVarcharDescriptor = new PgVarcharDescriptor();

export const pgVarcharColumn = (params: LengthParams = {}) =>
  column(
    pgVarcharDescriptor.factory(params),
    pgVarcharDescriptor.codecId,
    params,
    'character varying',
  );

pgVarcharColumn satisfies ColumnHelperFor<PgVarcharDescriptor>;

export class PgIntDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = PG_INT_CODEC_ID;
  override readonly targetTypes = ['int4'] as const;
  override readonly meta = PG_INT_META;
  override readonly traits = sqlIntDescriptorClass.traits;
  override readonly paramsSchema = sqlIntDescriptorClass.paramsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqlIntCodec {
    return () => new SqlIntCodec(this);
  }
}

export const pgIntDescriptor = new PgIntDescriptor();

export const pgIntColumn = () =>
  column(pgIntDescriptor.factory(), pgIntDescriptor.codecId, undefined, 'int4');

pgIntColumn satisfies ColumnHelperFor<PgIntDescriptor>;

export class PgFloatDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = PG_FLOAT_CODEC_ID;
  override readonly targetTypes = ['float8'] as const;
  override readonly meta = PG_FLOAT_META;
  override readonly traits = sqlFloatDescriptorClass.traits;
  override readonly paramsSchema = sqlFloatDescriptorClass.paramsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqlFloatCodec {
    return () => new SqlFloatCodec(this);
  }
}

export const pgFloatDescriptor = new PgFloatDescriptor();

export const pgFloatColumn = () =>
  column(pgFloatDescriptor.factory(), pgFloatDescriptor.codecId, undefined, 'float8');

pgFloatColumn satisfies ColumnHelperFor<PgFloatDescriptor>;

// ---------------------------------------------------------------------------
// Class-form descriptor map (TML-2357 M0 Phase B5/C). Keyed by scalar name
// so {@link CodecTypes} resolves through `ExtractCodecTypes`,
// preserving the input/output/traits shape downstream consumers
// (`descriptor-meta.ts`, `exports/codec-types.ts`) and contract emit paths
// rely on. The list view (`codecDescriptorClassList`) iterates these in the
// emit-stable order via `Object.values` — the runtime contributor pack
// (`pack.ts` / `runtime.ts`) consumes the list shape.
// ---------------------------------------------------------------------------

const codecDescriptorMap = {
  char: sqlCharDescriptorClass,
  varchar: sqlVarcharDescriptorClass,
  int: sqlIntDescriptorClass,
  float: sqlFloatDescriptorClass,
  'sql-text': sqlTextDescriptorClass,
  'sql-timestamp': sqlTimestampDescriptorClass,
  text: pgTextDescriptorClass,
  character: pgCharDescriptor,
  'character varying': pgVarcharDescriptor,
  integer: pgIntDescriptor,
  'double precision': pgFloatDescriptor,
  int4: pgInt4DescriptorClass,
  int2: pgInt2DescriptorClass,
  int8: pgInt8DescriptorClass,
  float4: pgFloat4DescriptorClass,
  float8: pgFloat8DescriptorClass,
  numeric: pgNumericDescriptorClass,
  timestamp: pgTimestampDescriptorClass,
  timestamptz: pgTimestamptzDescriptorClass,
  time: pgTimeDescriptorClass,
  timetz: pgTimetzDescriptorClass,
  bool: pgBoolDescriptorClass,
  bit: pgBitDescriptorClass,
  'bit varying': pgVarbitDescriptorClass,
  bytea: pgByteaDescriptorClass,
  interval: pgIntervalDescriptorClass,
  enum: pgEnumDescriptorClass,
  json: pgJsonDescriptorClass,
  jsonb: pgJsonbDescriptorClass,
} as const;

export type CodecTypes = ExtractCodecTypes<typeof codecDescriptorMap>;

export const codecDescriptorClassList: readonly AnyCodecDescriptor[] =
  Object.values(codecDescriptorMap);
