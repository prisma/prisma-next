/**
 * Class-based form of the native SQLite target codecs (TML-2357 M0
 * Phase B3). Mirrors the Postgres codec class form added in Phase B2
 * (`packages/3-targets/3-targets/postgres/src/core/codecs-class.ts`).
 *
 * Each codec ships as three artifacts:
 *
 * 1. A `SqliteXCodec` class extending {@link CodecImpl} that wraps the
 *    encode/decode/encodeJson/decodeJson conversions inline. SQLite's
 *    runtime conversions are simple enough that there is no shared
 *    helper module; the class bodies are the single source of truth.
 * 2. A `SqliteXDescriptor` class extending {@link CodecDescriptorImpl}
 *    declaring the codec id, traits, target types, and params schema.
 *    SQLite codecs do not carry `meta` (no per-target native-type meta
 *    today) and are all non-parameterized.
 * 3. A per-codec column helper (`sqliteXColumn`) that calls
 *    `descriptor.factory()` directly and packages the result into a
 *    {@link ColumnSpec} via the framework {@link column} packager. The
 *    helper is tied to its descriptor with `satisfies ColumnHelperFor`
 *    + `ColumnHelperForStrict` (every SQLite codec's resolved type is
 *    well-defined).
 *
 * After TML-2357 M0 Phase C this is the canonical source of SQLite codec
 * metadata and runtime behaviour — the legacy `mkCodec` / `defineCodec`
 * carriers (and the parallel `byScalar` / `codecDescriptorDefinitions`
 * collection exports) retired with the deletion sweep.
 *
 * Audit: every SQLite codec is non-parameterized and parameter-stateless;
 * `factory()` takes no params (`P = void`) and returns a fresh codec
 * constructed solely from `this`.
 */

import type { JsonValue } from '@prisma-next/contract/types';
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
  sqlCharDescriptorClass,
  sqlFloatDescriptorClass,
  sqlIntDescriptorClass,
  sqlVarcharDescriptorClass,
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

// ---------------------------------------------------------------------------
// sqlite/text@1 — non-parameterized, JSON-safe (string).
// ---------------------------------------------------------------------------

export class SqliteTextCodec extends CodecImpl<
  typeof SQLITE_TEXT_CODEC_ID,
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

export class SqliteTextDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = SQLITE_TEXT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqliteTextCodec {
    return () => new SqliteTextCodec(this);
  }
}

export const sqliteTextDescriptorClass = new SqliteTextDescriptor();

export const sqliteTextColumn = () =>
  column(sqliteTextDescriptorClass.factory(), sqliteTextDescriptorClass.codecId, undefined, 'text');

sqliteTextColumn satisfies ColumnHelperFor<SqliteTextDescriptor>;
sqliteTextColumn satisfies ColumnHelperForStrict<SqliteTextDescriptor>;

// ---------------------------------------------------------------------------
// sqlite/integer@1 — non-parameterized, JSON-safe (number).
// ---------------------------------------------------------------------------

export class SqliteIntegerCodec extends CodecImpl<
  typeof SQLITE_INTEGER_CODEC_ID,
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

export class SqliteIntegerDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = SQLITE_INTEGER_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['integer'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqliteIntegerCodec {
    return () => new SqliteIntegerCodec(this);
  }
}

export const sqliteIntegerDescriptorClass = new SqliteIntegerDescriptor();

export const sqliteIntegerColumn = () =>
  column(
    sqliteIntegerDescriptorClass.factory(),
    sqliteIntegerDescriptorClass.codecId,
    undefined,
    'integer',
  );

sqliteIntegerColumn satisfies ColumnHelperFor<SqliteIntegerDescriptor>;
sqliteIntegerColumn satisfies ColumnHelperForStrict<SqliteIntegerDescriptor>;

// ---------------------------------------------------------------------------
// sqlite/real@1 — non-parameterized, JSON-safe (number).
// ---------------------------------------------------------------------------

export class SqliteRealCodec extends CodecImpl<
  typeof SQLITE_REAL_CODEC_ID,
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

export class SqliteRealDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = SQLITE_REAL_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['real'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqliteRealCodec {
    return () => new SqliteRealCodec(this);
  }
}

export const sqliteRealDescriptorClass = new SqliteRealDescriptor();

export const sqliteRealColumn = () =>
  column(sqliteRealDescriptorClass.factory(), sqliteRealDescriptorClass.codecId, undefined, 'real');

sqliteRealColumn satisfies ColumnHelperFor<SqliteRealDescriptor>;
sqliteRealColumn satisfies ColumnHelperForStrict<SqliteRealDescriptor>;

// ---------------------------------------------------------------------------
// sqlite/blob@1 — non-parameterized; wire is `Uint8Array`, JSON form
// is base64 (round-trip through `Buffer`).
// ---------------------------------------------------------------------------

export class SqliteBlobCodec extends CodecImpl<
  typeof SQLITE_BLOB_CODEC_ID,
  readonly ['equality'],
  Uint8Array,
  Uint8Array
> {
  async encode(value: Uint8Array, _ctx: CodecCallContext): Promise<Uint8Array> {
    return value;
  }
  async decode(wire: Uint8Array, _ctx: CodecCallContext): Promise<Uint8Array> {
    return wire;
  }
  encodeJson(value: Uint8Array): JsonValue {
    return Buffer.from(value).toString('base64');
  }
  decodeJson(json: JsonValue): Uint8Array {
    if (typeof json !== 'string') {
      throw new TypeError('sqlite/blob@1 contract value must be a base64 string');
    }
    return new Uint8Array(Buffer.from(json, 'base64'));
  }
}

export class SqliteBlobDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = SQLITE_BLOB_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['blob'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqliteBlobCodec {
    return () => new SqliteBlobCodec(this);
  }
}

export const sqliteBlobDescriptorClass = new SqliteBlobDescriptor();

export const sqliteBlobColumn = () =>
  column(sqliteBlobDescriptorClass.factory(), sqliteBlobDescriptorClass.codecId, undefined, 'blob');

sqliteBlobColumn satisfies ColumnHelperFor<SqliteBlobDescriptor>;
sqliteBlobColumn satisfies ColumnHelperForStrict<SqliteBlobDescriptor>;

// ---------------------------------------------------------------------------
// sqlite/datetime@1 — non-parameterized; SQLite stores datetimes as
// TEXT (ISO-8601), so the wire type is `string` even though the input
// type is `Date`. JSON round-trip uses the same ISO-8601 string form.
// ---------------------------------------------------------------------------

export class SqliteDatetimeCodec extends CodecImpl<
  typeof SQLITE_DATETIME_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Date
> {
  async encode(value: Date, _ctx: CodecCallContext): Promise<string> {
    return value.toISOString();
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<Date> {
    return new Date(wire);
  }
  encodeJson(value: Date): JsonValue {
    return value.toISOString();
  }
  decodeJson(json: JsonValue): Date {
    if (typeof json !== 'string') {
      throw new TypeError('sqlite/datetime@1 contract value must be an ISO-8601 string');
    }
    return new Date(json);
  }
}

export class SqliteDatetimeDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = SQLITE_DATETIME_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqliteDatetimeCodec {
    return () => new SqliteDatetimeCodec(this);
  }
}

export const sqliteDatetimeDescriptorClass = new SqliteDatetimeDescriptor();

export const sqliteDatetimeColumn = () =>
  column(
    sqliteDatetimeDescriptorClass.factory(),
    sqliteDatetimeDescriptorClass.codecId,
    undefined,
    'text',
  );

sqliteDatetimeColumn satisfies ColumnHelperFor<SqliteDatetimeDescriptor>;
sqliteDatetimeColumn satisfies ColumnHelperForStrict<SqliteDatetimeDescriptor>;

// ---------------------------------------------------------------------------
// sqlite/json@1 — non-parameterized; SQLite stores JSON as TEXT.
// Wire accepts both string (already serialized) and a parsed `JsonValue`;
// decode normalizes to `JsonValue`. Input type is `JsonValue`; encode
// `JSON.stringify`s.
// ---------------------------------------------------------------------------

export class SqliteJsonCodec extends CodecImpl<
  typeof SQLITE_JSON_CODEC_ID,
  readonly ['equality'],
  string | JsonValue,
  JsonValue
> {
  async encode(value: JsonValue, _ctx: CodecCallContext): Promise<string> {
    return JSON.stringify(value);
  }
  async decode(wire: string | JsonValue, _ctx: CodecCallContext): Promise<JsonValue> {
    return typeof wire === 'string' ? (JSON.parse(wire) as JsonValue) : wire;
  }
  encodeJson(value: JsonValue): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): JsonValue {
    return json;
  }
}

export class SqliteJsonDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = SQLITE_JSON_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqliteJsonCodec {
    return () => new SqliteJsonCodec(this);
  }
}

export const sqliteJsonDescriptorClass = new SqliteJsonDescriptor();

export const sqliteJsonColumn = () =>
  column(sqliteJsonDescriptorClass.factory(), sqliteJsonDescriptorClass.codecId, undefined, 'text');

sqliteJsonColumn satisfies ColumnHelperFor<SqliteJsonDescriptor>;
sqliteJsonColumn satisfies ColumnHelperForStrict<SqliteJsonDescriptor>;

// ---------------------------------------------------------------------------
// sqlite/bigint@1 — non-parameterized; wire accepts `number | bigint`,
// decode normalizes to `bigint`. JSON form is the bigint stringified.
// ---------------------------------------------------------------------------

export class SqliteBigintCodec extends CodecImpl<
  typeof SQLITE_BIGINT_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number | bigint,
  bigint
> {
  async encode(value: bigint, _ctx: CodecCallContext): Promise<number | bigint> {
    return value;
  }
  async decode(wire: number | bigint, _ctx: CodecCallContext): Promise<bigint> {
    return BigInt(wire);
  }
  encodeJson(value: bigint): JsonValue {
    return value.toString();
  }
  decodeJson(json: JsonValue): bigint {
    if (typeof json !== 'string' && typeof json !== 'number') {
      throw new TypeError('sqlite/bigint@1 contract value must be a string or number');
    }
    return BigInt(json);
  }
}

export class SqliteBigintDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = SQLITE_BIGINT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['integer'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqliteBigintCodec {
    return () => new SqliteBigintCodec(this);
  }
}

export const sqliteBigintDescriptorClass = new SqliteBigintDescriptor();

export const sqliteBigintColumn = () =>
  column(
    sqliteBigintDescriptorClass.factory(),
    sqliteBigintDescriptorClass.codecId,
    undefined,
    'integer',
  );

sqliteBigintColumn satisfies ColumnHelperFor<SqliteBigintDescriptor>;
sqliteBigintColumn satisfies ColumnHelperForStrict<SqliteBigintDescriptor>;

// ---------------------------------------------------------------------------
// Class-form descriptor map (TML-2357 M0 Phase B5/C). Keyed by scalar name
// so {@link CodecTypes} resolves through `ExtractCodecTypes`,
// preserving the input/output/traits shape downstream consumers
// (`descriptor-meta.ts`, `exports/codec-types.ts`) and contract emit paths
// rely on. The list view (`codecDescriptorClassList`) iterates these in the
// emit-stable order via `Object.values` — the runtime contributor pack
// consumes the list shape.
// ---------------------------------------------------------------------------

const codecDescriptorMap = {
  char: sqlCharDescriptorClass,
  varchar: sqlVarcharDescriptorClass,
  int: sqlIntDescriptorClass,
  float: sqlFloatDescriptorClass,
  text: sqliteTextDescriptorClass,
  integer: sqliteIntegerDescriptorClass,
  real: sqliteRealDescriptorClass,
  blob: sqliteBlobDescriptorClass,
  datetime: sqliteDatetimeDescriptorClass,
  json: sqliteJsonDescriptorClass,
  bigint: sqliteBigintDescriptorClass,
} as const;

export type CodecTypes = ExtractCodecTypes<typeof codecDescriptorMap>;

export const codecDescriptorClassList: readonly AnyCodecDescriptor[] =
  Object.values(codecDescriptorMap);
