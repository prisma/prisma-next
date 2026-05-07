/**
 * Class-based form of the six SQL base codecs (TML-2357 M0 Phase B1/C).
 *
 * Each codec ships as three artifacts:
 *
 * 1. A `SqlXCodec` class extending {@link CodecImpl} that wraps the
 *    module-level encode/decode constants exported from `sql-codecs.ts`
 *    (the single source of truth for runtime behaviour).
 * 2. A `SqlXDescriptor` class extending {@link CodecDescriptorImpl}
 *    declaring the codec id, traits, target types, params schema, and
 *    (where applicable) the emit-path `renderOutputType`.
 * 3. A per-codec column helper (`sqlXColumn`) that calls
 *    `descriptor.factory(...)` directly and packages the result into a
 *    {@link ColumnSpec} via the framework {@link column} packager. The
 *    helper is tied to its descriptor with `satisfies ColumnHelperFor`.
 *
 * After Phase C, this file is the canonical source of SQL base codec
 * metadata and runtime behaviour — the legacy `mkCodec` / `defineCodec`
 * carriers in `sql-codecs.ts` retired with the deletion sweep.
 */

import { arktypeParamsSchema, type JsonValue } from '@prisma-next/contract/types';
import {
  type CodecCallContext,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
  voidParamsSchema,
} from '@prisma-next/framework-components/codec';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { type as arktype } from 'arktype';
import {
  SQL_CHAR_CODEC_ID,
  SQL_FLOAT_CODEC_ID,
  SQL_INT_CODEC_ID,
  SQL_TEXT_CODEC_ID,
  SQL_TIMESTAMP_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
  sqlCharDecode,
  sqlCharEncode,
  sqlCharRenderOutputType,
  sqlFloatDecode,
  sqlFloatEncode,
  sqlIntDecode,
  sqlIntEncode,
  sqlTextDecode,
  sqlTextEncode,
  sqlTimestampDecode,
  sqlTimestampDecodeJson,
  sqlTimestampEncode,
  sqlTimestampEncodeJson,
  sqlTimestampRenderOutputType,
  sqlVarcharDecode,
  sqlVarcharEncode,
  sqlVarcharRenderOutputType,
} from './sql-codecs';

// ---------------------------------------------------------------------------
// Params schemas. Reconstructed locally so the legacy `sql-codecs.ts`
// content stays untouched; the validators are JSON-boundary metadata,
// not runtime conversion behaviour.
// ---------------------------------------------------------------------------

const lengthParamsSchema = arktype({
  length: 'number.integer > 0',
});

const precisionParamsSchema = arktype({
  'precision?': 'number.integer >= 0 & number.integer <= 6',
});

type LengthParams = { readonly length?: number };
type PrecisionParams = { readonly precision?: number };

// ---------------------------------------------------------------------------
// sql/text@1 — non-parameterized, JSON-safe (string).
// ---------------------------------------------------------------------------

export class SqlTextCodec extends CodecImpl<
  typeof SQL_TEXT_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return sqlTextEncode(value);
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return sqlTextDecode(wire);
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

export class SqlTextDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = SQL_TEXT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqlTextCodec {
    return () => new SqlTextCodec(this);
  }
}

export const sqlTextDescriptorClass = new SqlTextDescriptor();

export const sqlTextColumn = () =>
  column(sqlTextDescriptorClass.factory(), sqlTextDescriptorClass.codecId, undefined, 'text');

sqlTextColumn satisfies ColumnHelperFor<SqlTextDescriptor>;
sqlTextColumn satisfies ColumnHelperForStrict<SqlTextDescriptor>;

// ---------------------------------------------------------------------------
// sql/int@1 — non-parameterized, JSON-safe (number).
// ---------------------------------------------------------------------------

export class SqlIntCodec extends CodecImpl<
  typeof SQL_INT_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
> {
  async encode(value: number, _ctx: CodecCallContext): Promise<number> {
    return sqlIntEncode(value);
  }
  async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
    return sqlIntDecode(wire);
  }
  encodeJson(value: number): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): number {
    return json as number;
  }
}

export class SqlIntDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = SQL_INT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['int'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqlIntCodec {
    return () => new SqlIntCodec(this);
  }
}

export const sqlIntDescriptorClass = new SqlIntDescriptor();

export const sqlIntColumn = () =>
  column(sqlIntDescriptorClass.factory(), sqlIntDescriptorClass.codecId, undefined, 'int');

sqlIntColumn satisfies ColumnHelperFor<SqlIntDescriptor>;
sqlIntColumn satisfies ColumnHelperForStrict<SqlIntDescriptor>;

// ---------------------------------------------------------------------------
// sql/float@1 — non-parameterized, JSON-safe (number).
// ---------------------------------------------------------------------------

export class SqlFloatCodec extends CodecImpl<
  typeof SQL_FLOAT_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
> {
  async encode(value: number, _ctx: CodecCallContext): Promise<number> {
    return sqlFloatEncode(value);
  }
  async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
    return sqlFloatDecode(wire);
  }
  encodeJson(value: number): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): number {
    return json as number;
  }
}

export class SqlFloatDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = SQL_FLOAT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['float'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqlFloatCodec {
    return () => new SqlFloatCodec(this);
  }
}

export const sqlFloatDescriptorClass = new SqlFloatDescriptor();

export const sqlFloatColumn = () =>
  column(sqlFloatDescriptorClass.factory(), sqlFloatDescriptorClass.codecId, undefined, 'float');

sqlFloatColumn satisfies ColumnHelperFor<SqlFloatDescriptor>;
sqlFloatColumn satisfies ColumnHelperForStrict<SqlFloatDescriptor>;

// ---------------------------------------------------------------------------
// sql/char@1 — length-parameterized, JSON-safe (string). Params are JSON-only
// metadata; the codec is parameter-stateless (decode trims trailing spaces
// regardless of length), so the codec constructor takes only the descriptor.
// ---------------------------------------------------------------------------

export class SqlCharCodec extends CodecImpl<
  typeof SQL_CHAR_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return sqlCharEncode(value);
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return sqlCharDecode(wire);
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

export class SqlCharDescriptor extends CodecDescriptorImpl<LengthParams> {
  override readonly codecId = SQL_CHAR_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly targetTypes = ['char'] as const;
  override readonly paramsSchema = arktypeParamsSchema<LengthParams>(lengthParamsSchema);
  override renderOutputType(params: LengthParams): string | undefined {
    return sqlCharRenderOutputType(params);
  }
  override factory(_params: LengthParams): (ctx: CodecInstanceContext) => SqlCharCodec {
    return () => new SqlCharCodec(this);
  }
}

export const sqlCharDescriptorClass = new SqlCharDescriptor();

export const sqlCharColumn = (params: LengthParams = {}) =>
  column(sqlCharDescriptorClass.factory(params), sqlCharDescriptorClass.codecId, params, 'char');

sqlCharColumn satisfies ColumnHelperFor<SqlCharDescriptor>;
sqlCharColumn satisfies ColumnHelperForStrict<SqlCharDescriptor>;

// ---------------------------------------------------------------------------
// sql/varchar@1 — length-parameterized, JSON-safe (string).
// ---------------------------------------------------------------------------

export class SqlVarcharCodec extends CodecImpl<
  typeof SQL_VARCHAR_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return sqlVarcharEncode(value);
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return sqlVarcharDecode(wire);
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

export class SqlVarcharDescriptor extends CodecDescriptorImpl<LengthParams> {
  override readonly codecId = SQL_VARCHAR_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly targetTypes = ['varchar'] as const;
  override readonly paramsSchema = arktypeParamsSchema<LengthParams>(lengthParamsSchema);
  override renderOutputType(params: LengthParams): string | undefined {
    return sqlVarcharRenderOutputType(params);
  }
  override factory(_params: LengthParams): (ctx: CodecInstanceContext) => SqlVarcharCodec {
    return () => new SqlVarcharCodec(this);
  }
}

export const sqlVarcharDescriptorClass = new SqlVarcharDescriptor();

export const sqlVarcharColumn = (params: LengthParams = {}) =>
  column(
    sqlVarcharDescriptorClass.factory(params),
    sqlVarcharDescriptorClass.codecId,
    params,
    'varchar',
  );

sqlVarcharColumn satisfies ColumnHelperFor<SqlVarcharDescriptor>;
sqlVarcharColumn satisfies ColumnHelperForStrict<SqlVarcharDescriptor>;

// ---------------------------------------------------------------------------
// sql/timestamp@1 — precision-parameterized, NOT JSON-safe (Date). Custom
// `encodeJson`/`decodeJson` round-trip through ISO-8601 strings.
// ---------------------------------------------------------------------------

export class SqlTimestampCodec extends CodecImpl<
  typeof SQL_TIMESTAMP_CODEC_ID,
  readonly ['equality', 'order'],
  Date,
  Date
> {
  async encode(value: Date, _ctx: CodecCallContext): Promise<Date> {
    return sqlTimestampEncode(value);
  }
  async decode(wire: Date, _ctx: CodecCallContext): Promise<Date> {
    return sqlTimestampDecode(wire);
  }
  encodeJson(value: Date): JsonValue {
    return sqlTimestampEncodeJson(value);
  }
  decodeJson(json: JsonValue): Date {
    return sqlTimestampDecodeJson(json);
  }
}

export class SqlTimestampDescriptor extends CodecDescriptorImpl<PrecisionParams> {
  override readonly codecId = SQL_TIMESTAMP_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['timestamp'] as const;
  override readonly paramsSchema = arktypeParamsSchema<PrecisionParams>(precisionParamsSchema);
  override renderOutputType(params: PrecisionParams): string | undefined {
    return sqlTimestampRenderOutputType(params);
  }
  override factory(_params: PrecisionParams): (ctx: CodecInstanceContext) => SqlTimestampCodec {
    return () => new SqlTimestampCodec(this);
  }
}

export const sqlTimestampDescriptorClass = new SqlTimestampDescriptor();

export const sqlTimestampColumn = (params: PrecisionParams = {}) =>
  column(
    sqlTimestampDescriptorClass.factory(params),
    sqlTimestampDescriptorClass.codecId,
    params,
    'timestamp',
  );

sqlTimestampColumn satisfies ColumnHelperFor<SqlTimestampDescriptor>;
sqlTimestampColumn satisfies ColumnHelperForStrict<SqlTimestampDescriptor>;
