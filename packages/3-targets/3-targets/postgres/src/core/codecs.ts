/**
 * Unified codec definitions for Postgres adapter.
 *
 * This file contains a single source of truth for all codec information:
 * - Scalar names
 * - Type IDs
 * - Codec implementations (runtime)
 * - Type information (compile-time)
 *
 * This structure is used both at runtime (to populate the registry) and
 * at compile time (to derive CodecTypes).
 */

import type { JsonValue } from '@prisma-next/contract/types';
import {
  CodecDescriptorImpl,
  type CodecInstanceContext,
} from '@prisma-next/framework-components/codec';
import type { Codec } from '@prisma-next/sql-relational-core/ast';
import {
  defineCodec,
  defineCodecBundle,
  defineCodecGroup,
  mkCodec,
  sqlCharDescriptor,
  sqlCodecDefinitions,
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

// ---------------------------------------------------------------------------
// Shared encode/decode/render constants. The legacy `mkCodec`/`defineCodec`
// forms below and the class form in `codecs-class.ts` (TML-2357 M0 Phase
// B2) both consume these so both paths share a single source of truth for
// runtime behaviour. Trivial identity passthroughs (e.g. `pgInt4Encode`)
// stay inline in both forms — a `(v) => v` body cannot diverge from
// itself.
// ---------------------------------------------------------------------------

export function renderLength(
  typeName: string,
  typeParams: Record<string, unknown>,
): string | undefined {
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

export function renderPrecision(typeName: string, typeParams: Record<string, unknown>): string {
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

export const pgNumericDecode = (wire: string | number): string => {
  if (typeof wire === 'number') return String(wire);
  return wire;
};

export const pgNumericRenderOutputType = (typeParams: {
  readonly precision: number;
  readonly scale?: number;
}): string | undefined => {
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
};

export const pgTimestampEncodeJson = (value: Date): JsonValue => value.toISOString();
export const pgTimestampDecodeJson = (json: JsonValue): Date => {
  if (typeof json !== 'string') {
    throw new Error(`Expected ISO date string for pg/timestamp@1, got ${typeof json}`);
  }
  const date = new Date(json);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO date string for pg/timestamp@1: ${json}`);
  }
  return date;
};

export const pgTimestamptzEncodeJson = (value: Date): JsonValue => value.toISOString();
export const pgTimestamptzDecodeJson = (json: JsonValue): Date => {
  if (typeof json !== 'string') {
    throw new Error(`Expected ISO date string for pg/timestamptz@1, got ${typeof json}`);
  }
  const date = new Date(json);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO date string for pg/timestamptz@1: ${json}`);
  }
  return date;
};

export const pgIntervalDecode = (wire: string | Record<string, unknown>): string => {
  if (typeof wire === 'string') return wire;
  return JSON.stringify(wire);
};

export const pgEnumRenderOutputType = (typeParams: {
  readonly values?: readonly unknown[];
}): string => {
  const values = typeParams.values;
  if (!Array.isArray(values)) {
    throw new Error(
      `renderOutputType: expected array "values" in typeParams for enum, got ${typeof values}`,
    );
  }
  return values
    .map((value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
    .join(' | ');
};

export const pgJsonEncode = (value: string | JsonValue): string => JSON.stringify(value);
export const pgJsonDecode = (wire: string | JsonValue): JsonValue =>
  typeof wire === 'string' ? JSON.parse(wire) : wire;

export const pgJsonbEncode = (value: string | JsonValue): string => JSON.stringify(value);
export const pgJsonbDecode = (wire: string | JsonValue): JsonValue =>
  typeof wire === 'string' ? JSON.parse(wire) : wire;

// Phase C: postgres' raw json/jsonb codecs no longer carry a
// `renderOutputType` slot — the schema-typed JSON surface that drove
// `typeParams: { schemaJson, type? }` retired in favor of the per-library
// extension package (`@prisma-next/extension-arktype-json`). Untyped
// json/jsonb columns have no typeParams; the framework emit path falls
// through to the generic `CodecTypes['pg/jsonb@1']['output']` accessor
// (which resolves to `JsonValue` via the codec-types map).

const sqlCharCodec = sqlCodecDefinitions.char.codec;
const sqlVarcharCodec = sqlCodecDefinitions.varchar.codec;
const sqlIntCodec = sqlCodecDefinitions.int.codec;
const sqlFloatCodec = sqlCodecDefinitions.float.codec;
const sqlTextCodec = sqlCodecDefinitions.text.codec;
const sqlTimestampCodec = sqlCodecDefinitions.timestamp.codec;

// Create individual codec instances
const pgTextCodec = mkCodec({
  typeId: PG_TEXT_CODEC_ID,
  targetTypes: ['text'],
  traits: ['equality', 'order', 'textual'],
  encode: (value: string): string => value,
  decode: (wire: string): string => wire,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'text',
        },
      },
    },
  },
});

// Prototype-preserving codec aliasing: derive a codec instance whose
// `id` is the alias `codecId` while inheriting the base codec's behavior
// (own properties via `Object.assign`, prototype methods via the shared
// prototype). Works for both plain-object base codecs (today's
// `defineCodec` output) and class-instance base codecs (post-Phase B,
// when SQL bases migrate to `CodecImpl` subclasses with methods on the
// prototype). A naive `{ ...base, id }` spread would silently strip
// prototype methods at first encode/decode call.
function aliasCodec<C extends { readonly id: string }, AliasId extends string>(
  baseCodec: C,
  codecId: AliasId,
): Omit<C, 'id'> & { readonly id: AliasId } {
  const proto = Object.getPrototypeOf(baseCodec) as object | null;
  const aliased = Object.create(proto ?? Object.prototype) as Omit<C, 'id'> & {
    readonly id: AliasId;
  };
  Object.assign(aliased, baseCodec);
  Object.defineProperty(aliased, 'id', {
    value: codecId,
    writable: false,
    enumerable: true,
    configurable: true,
  });
  return aliased;
}

const pgCharCodec: Codec<typeof PG_CHAR_CODEC_ID> = aliasCodec(sqlCharCodec, PG_CHAR_CODEC_ID);
const pgVarcharCodec: Codec<typeof PG_VARCHAR_CODEC_ID> = aliasCodec(
  sqlVarcharCodec,
  PG_VARCHAR_CODEC_ID,
);
const pgIntCodec: Codec<typeof PG_INT_CODEC_ID> = aliasCodec(sqlIntCodec, PG_INT_CODEC_ID);
const pgFloatCodec: Codec<typeof PG_FLOAT_CODEC_ID> = aliasCodec(sqlFloatCodec, PG_FLOAT_CODEC_ID);

const pgInt4Codec = mkCodec({
  typeId: PG_INT4_CODEC_ID,
  targetTypes: ['int4'],
  traits: ['equality', 'order', 'numeric'],
  encode: (value: number): number => value,
  decode: (wire: number): number => wire,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'integer',
        },
      },
    },
  },
});

const pgNumericCodec = mkCodec<
  typeof PG_NUMERIC_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  string,
  string
>({
  typeId: PG_NUMERIC_CODEC_ID,
  targetTypes: ['numeric', 'decimal'],
  traits: ['equality', 'order', 'numeric'],
  encode: (value: string): string => value,
  decode: pgNumericDecode,
  paramsSchema: numericParamsSchema,
  renderOutputType: (typeParams) =>
    pgNumericRenderOutputType(
      typeParams as { readonly precision: number; readonly scale?: number },
    ),
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'numeric',
        },
      },
    },
  },
});

const pgInt2Codec = mkCodec({
  typeId: PG_INT2_CODEC_ID,
  targetTypes: ['int2'],
  traits: ['equality', 'order', 'numeric'],
  encode: (value: number): number => value,
  decode: (wire: number): number => wire,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'smallint',
        },
      },
    },
  },
});

const pgInt8Codec = mkCodec({
  typeId: PG_INT8_CODEC_ID,
  targetTypes: ['int8'],
  traits: ['equality', 'order', 'numeric'],
  encode: (value: number): number => value,
  decode: (wire: number): number => wire,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'bigint',
        },
      },
    },
  },
});

const pgFloat4Codec = mkCodec({
  typeId: PG_FLOAT4_CODEC_ID,
  targetTypes: ['float4'],
  traits: ['equality', 'order', 'numeric'],
  encode: (value: number): number => value,
  decode: (wire: number): number => wire,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'real',
        },
      },
    },
  },
});

const pgFloat8Codec = mkCodec({
  typeId: PG_FLOAT8_CODEC_ID,
  targetTypes: ['float8'],
  traits: ['equality', 'order', 'numeric'],
  encode: (value: number): number => value,
  decode: (wire: number): number => wire,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'double precision',
        },
      },
    },
  },
});

const pgTimestampCodec = mkCodec<
  typeof PG_TIMESTAMP_CODEC_ID,
  readonly ['equality', 'order'],
  Date,
  Date
>({
  typeId: PG_TIMESTAMP_CODEC_ID,
  targetTypes: ['timestamp'],
  traits: ['equality', 'order'],
  encode: (value: Date): Date => value,
  decode: (wire: Date): Date => wire,
  encodeJson: pgTimestampEncodeJson,
  decodeJson: pgTimestampDecodeJson,
  paramsSchema: precisionParamsSchema,
  renderOutputType: (typeParams) => renderPrecision('Timestamp', typeParams),
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'timestamp without time zone',
        },
      },
    },
  },
});

const pgTimestamptzCodec = mkCodec<
  typeof PG_TIMESTAMPTZ_CODEC_ID,
  readonly ['equality', 'order'],
  Date,
  Date
>({
  typeId: PG_TIMESTAMPTZ_CODEC_ID,
  targetTypes: ['timestamptz'],
  traits: ['equality', 'order'],
  encode: (value: Date): Date => value,
  decode: (wire: Date): Date => wire,
  encodeJson: pgTimestamptzEncodeJson,
  decodeJson: pgTimestamptzDecodeJson,
  paramsSchema: precisionParamsSchema,
  renderOutputType: (typeParams) => renderPrecision('Timestamptz', typeParams),
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'timestamp with time zone',
        },
      },
    },
  },
});

const pgTimeCodec = mkCodec<
  typeof PG_TIME_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
>({
  typeId: PG_TIME_CODEC_ID,
  targetTypes: ['time'],
  traits: ['equality', 'order'],
  encode: (value: string): string => value,
  decode: (wire: string): string => wire,
  paramsSchema: precisionParamsSchema,
  renderOutputType: (typeParams) => renderPrecision('Time', typeParams),
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'time',
        },
      },
    },
  },
});

const pgTimetzCodec = mkCodec<
  typeof PG_TIMETZ_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
>({
  typeId: PG_TIMETZ_CODEC_ID,
  targetTypes: ['timetz'],
  traits: ['equality', 'order'],
  encode: (value: string): string => value,
  decode: (wire: string): string => wire,
  paramsSchema: precisionParamsSchema,
  renderOutputType: (typeParams) => renderPrecision('Timetz', typeParams),
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'timetz',
        },
      },
    },
  },
});

const pgBoolCodec = mkCodec({
  typeId: PG_BOOL_CODEC_ID,
  targetTypes: ['bool'],
  traits: ['equality', 'boolean'],
  encode: (value: boolean): boolean => value,
  decode: (wire: boolean): boolean => wire,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'boolean',
        },
      },
    },
  },
});

const pgBitCodec = mkCodec<typeof PG_BIT_CODEC_ID, readonly ['equality', 'order'], string, string>({
  typeId: PG_BIT_CODEC_ID,
  targetTypes: ['bit'],
  traits: ['equality', 'order'],
  encode: (value: string): string => value,
  decode: (wire: string): string => wire,
  paramsSchema: lengthParamsSchema,
  renderOutputType: (typeParams) => renderLength('Bit', typeParams),
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'bit',
        },
      },
    },
  },
});

const pgVarbitCodec = mkCodec<
  typeof PG_VARBIT_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
>({
  typeId: PG_VARBIT_CODEC_ID,
  targetTypes: ['bit varying'],
  traits: ['equality', 'order'],
  encode: (value: string): string => value,
  decode: (wire: string): string => wire,
  paramsSchema: lengthParamsSchema,
  renderOutputType: (typeParams) => renderLength('VarBit', typeParams),
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'bit varying',
        },
      },
    },
  },
});

const pgEnumCodec = mkCodec({
  typeId: PG_ENUM_CODEC_ID,
  targetTypes: ['enum'],
  traits: ['equality', 'order'],
  encode: (value: string): string => value,
  decode: (wire: string): string => wire,
  renderOutputType: (typeParams) =>
    pgEnumRenderOutputType(typeParams as { readonly values?: readonly unknown[] }),
});

const pgIntervalCodec = mkCodec<
  typeof PG_INTERVAL_CODEC_ID,
  readonly ['equality', 'order'],
  string | Record<string, unknown>,
  string
>({
  typeId: PG_INTERVAL_CODEC_ID,
  targetTypes: ['interval'],
  traits: ['equality', 'order'],
  encode: (value: string): string => value,
  decode: pgIntervalDecode,
  paramsSchema: precisionParamsSchema,
  renderOutputType: (typeParams) => renderPrecision('Interval', typeParams),
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'interval',
        },
      },
    },
  },
});

const pgJsonCodec = mkCodec({
  typeId: PG_JSON_CODEC_ID,
  targetTypes: ['json'],
  traits: [],
  encode: pgJsonEncode,
  decode: pgJsonDecode,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'json',
        },
      },
    },
  },
});

const pgJsonbCodec = mkCodec({
  typeId: PG_JSONB_CODEC_ID,
  targetTypes: ['jsonb'],
  traits: ['equality'],
  encode: pgJsonbEncode,
  decode: pgJsonbDecode,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'jsonb',
        },
      },
    },
  },
});

// Build codec definitions using the builder DSL
const codecs = defineCodecGroup()
  .add('char', sqlCharCodec)
  .add('varchar', sqlVarcharCodec)
  .add('int', sqlIntCodec)
  .add('float', sqlFloatCodec)
  .add('sql-text', sqlTextCodec)
  .add('sql-timestamp', sqlTimestampCodec)
  .add('text', pgTextCodec)
  .add('character', pgCharCodec)
  .add('character varying', pgVarcharCodec)
  .add('integer', pgIntCodec)
  .add('double precision', pgFloatCodec)
  .add('int4', pgInt4Codec)
  .add('int2', pgInt2Codec)
  .add('int8', pgInt8Codec)
  .add('float4', pgFloat4Codec)
  .add('float8', pgFloat8Codec)
  .add('numeric', pgNumericCodec)
  .add('timestamp', pgTimestampCodec)
  .add('timestamptz', pgTimestamptzCodec)
  .add('time', pgTimeCodec)
  .add('timetz', pgTimetzCodec)
  .add('bool', pgBoolCodec)
  .add('bit', pgBitCodec)
  .add('bit varying', pgVarbitCodec)
  .add('interval', pgIntervalCodec)
  .add('enum', pgEnumCodec)
  .add('json', pgJsonCodec)
  .add('jsonb', pgJsonbCodec);

// Export derived structures directly from codecs builder
export const byScalar = codecs.byScalar;
export const dataTypes = codecs.dataTypes;

export type CodecTypes = typeof codecs.CodecTypes;

// ---------------------------------------------------------------------------
// Native CodecDescriptor exports (TML-2357 T2.3). Each postgres target codec
// gains a sibling `*Descriptor` authored via `defineCodec()` (or composed
// from a SQL base descriptor via `aliasDescriptor`). The legacy codec
// exports above still flow through the `byScalar[k].codec` surface
// the postgres adapter + extension consumers read; both shapes ship until
// the M2 cleanup commit collapses to descriptor-only.
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

class PgCharDescriptor extends CodecDescriptorImpl<{ readonly length?: number }> {
  override readonly codecId = PG_CHAR_CODEC_ID;
  override readonly targetTypes: readonly string[] = ['character'];
  override readonly meta = { db: { sql: { postgres: { nativeType: 'character' } } } };
  override readonly traits = sqlCharDescriptor.traits;
  override readonly paramsSchema = sqlCharDescriptor.paramsSchema;
  override renderOutputType(params: { readonly length?: number }): string | undefined {
    return sqlCharDescriptor.renderOutputType?.(params);
  }
  override factory(params: { readonly length?: number }): (ctx: CodecInstanceContext) => Codec {
    const baseFactory = sqlCharDescriptor.factory(params);
    const codecId = this.codecId;
    return (ctx) => aliasCodec(baseFactory(ctx) as Codec, codecId);
  }
}
export const pgCharDescriptor = new PgCharDescriptor();

class PgVarcharDescriptor extends CodecDescriptorImpl<{ readonly length?: number }> {
  override readonly codecId = PG_VARCHAR_CODEC_ID;
  override readonly targetTypes: readonly string[] = ['character varying'];
  override readonly meta = { db: { sql: { postgres: { nativeType: 'character varying' } } } };
  override readonly traits = sqlVarcharDescriptor.traits;
  override readonly paramsSchema = sqlVarcharDescriptor.paramsSchema;
  override renderOutputType(params: { readonly length?: number }): string | undefined {
    return sqlVarcharDescriptor.renderOutputType?.(params);
  }
  override factory(params: { readonly length?: number }): (ctx: CodecInstanceContext) => Codec {
    const baseFactory = sqlVarcharDescriptor.factory(params);
    const codecId = this.codecId;
    return (ctx) => aliasCodec(baseFactory(ctx) as Codec, codecId);
  }
}
export const pgVarcharDescriptor = new PgVarcharDescriptor();

class PgIntDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = PG_INT_CODEC_ID;
  override readonly targetTypes: readonly string[] = ['int4'];
  override readonly meta = { db: { sql: { postgres: { nativeType: 'integer' } } } };
  override readonly traits = sqlIntDescriptor.traits;
  override readonly paramsSchema = sqlIntDescriptor.paramsSchema;
  override factory(): (ctx: CodecInstanceContext) => Codec {
    const baseFactory = sqlIntDescriptor.factory();
    const codecId = this.codecId;
    return (ctx) => aliasCodec(baseFactory(ctx) as Codec, codecId);
  }
}
export const pgIntDescriptor = new PgIntDescriptor();

class PgFloatDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = PG_FLOAT_CODEC_ID;
  override readonly targetTypes: readonly string[] = ['float8'];
  override readonly meta = { db: { sql: { postgres: { nativeType: 'double precision' } } } };
  override readonly traits = sqlFloatDescriptor.traits;
  override readonly paramsSchema = sqlFloatDescriptor.paramsSchema;
  override factory(): (ctx: CodecInstanceContext) => Codec {
    const baseFactory = sqlFloatDescriptor.factory();
    const codecId = this.codecId;
    return (ctx) => aliasCodec(baseFactory(ctx) as Codec, codecId);
  }
}
export const pgFloatDescriptor = new PgFloatDescriptor();

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
  decode: pgNumericDecode,
  paramsSchema: numericParamsSchema,
  renderOutputType: pgNumericRenderOutputType,
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
  encodeJson: pgTimestampEncodeJson,
  decodeJson: pgTimestampDecodeJson,
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
  encodeJson: pgTimestamptzEncodeJson,
  decodeJson: pgTimestamptzDecodeJson,
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
  renderOutputType: pgEnumRenderOutputType,
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
  decode: pgIntervalDecode,
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
  encode: pgJsonEncode,
  decode: pgJsonDecode,
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
  encode: pgJsonbEncode,
  decode: pgJsonbDecode,
  meta: { db: { sql: { postgres: { nativeType: 'jsonb' } } } },
});

const codecDescriptorsBuilder = defineCodecBundle()
  .add('char', sqlCharDescriptor)
  .add('varchar', sqlVarcharDescriptor)
  .add('int', sqlIntDescriptor)
  .add('float', sqlFloatDescriptor)
  .add('sql-text', sqlTextDescriptor)
  .add('sql-timestamp', sqlTimestampDescriptor)
  .add('text', pgTextDescriptor)
  .add('character', pgCharDescriptor)
  .add('character varying', pgVarcharDescriptor)
  .add('integer', pgIntDescriptor)
  .add('double precision', pgFloatDescriptor)
  .add('int4', pgInt4Descriptor)
  .add('int2', pgInt2Descriptor)
  .add('int8', pgInt8Descriptor)
  .add('float4', pgFloat4Descriptor)
  .add('float8', pgFloat8Descriptor)
  .add('numeric', pgNumericDescriptor)
  .add('timestamp', pgTimestampDescriptor)
  .add('timestamptz', pgTimestamptzDescriptor)
  .add('time', pgTimeDescriptor)
  .add('timetz', pgTimetzDescriptor)
  .add('bool', pgBoolDescriptor)
  .add('bit', pgBitDescriptor)
  .add('bit varying', pgVarbitDescriptor)
  .add('bytea', pgByteaDescriptor)
  .add('interval', pgIntervalDescriptor)
  .add('enum', pgEnumDescriptor)
  .add('json', pgJsonDescriptor)
  .add('jsonb', pgJsonbDescriptor);

/**
 * Descriptor view of the postgres target codecs, keyed by scalar name.
 * Mirrors {@link byScalar} for the descriptor shape (TML-2357
 * T2.3); the runtime contributor protocol switches to consume this map
 * once the unified `codecs:` slot lands later in M2.
 */
export const codecDescriptorDefinitions = codecDescriptorsBuilder.byScalar;

/**
 * Flat array of every postgres target codec descriptor — ready to feed
 * into a contributor's unified `codecs:` slot.
 */
export const codecDescriptorList = codecDescriptorsBuilder.descriptors;
