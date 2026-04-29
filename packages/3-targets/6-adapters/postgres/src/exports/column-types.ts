/**
 * Column type descriptors for Postgres adapter.
 *
 * Pack-author surface for parameterized columns. Each parameterized factory
 * returns a `ColumnTypeDescriptor` carrying both the data part (`codecId`,
 * `nativeType`, `typeParams`) AND a curried higher-order codec factory in the
 * `type` slot so the no-emit `FieldOutputType` resolver derives the column's
 * resolved JS type as the brand (`Char<N>`, `Numeric<P, S>`, etc.) without
 * needing to infer through the codec registry. See [ADR 205](../../../../../../docs/architecture%20docs/adrs/ADR%20205%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).
 */

import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import type { Ctx } from '@prisma-next/framework-components/codec';
import type { StorageTypeInstance } from '@prisma-next/sql-contract/types';
import {
  PG_BIT_CODEC_ID,
  PG_BOOL_CODEC_ID,
  PG_ENUM_CODEC_ID,
  PG_FLOAT4_CODEC_ID,
  PG_FLOAT8_CODEC_ID,
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
  SQL_CHAR_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
} from '../core/codec-ids';
import {
  type BitCodec,
  bitCodecForLength,
  type CharCodec,
  charCodecForLength,
  type IntervalCodec,
  intervalCodecForPrecision,
  type NumericCodec,
  numericCodecForParams,
  pgJsonbValueFactory,
  pgJsonValueFactory,
  type TimeCodec,
  type TimetzCodec,
  timeCodecForPrecision,
  timestampCodecForPrecision,
  timestamptzCodecForPrecision,
  timetzCodecForPrecision,
  type VarBitCodec,
  type VarcharCodec,
  varbitCodecForLength,
  varcharCodecForLength,
} from '../core/parameterized-codec-factories';

export const textColumn = {
  codecId: PG_TEXT_CODEC_ID,
  nativeType: 'text',
} as const satisfies ColumnTypeDescriptor;

export function charColumn<N extends number>(
  length: N,
): ColumnTypeDescriptor & {
  readonly codecId: typeof SQL_CHAR_CODEC_ID;
  readonly nativeType: 'character';
  readonly typeParams: { readonly length: N };
  readonly type: (ctx: Ctx) => CharCodec<N>;
} {
  return {
    codecId: SQL_CHAR_CODEC_ID,
    nativeType: 'character',
    typeParams: { length },
    type: charCodecForLength(length),
  } as const;
}

export function varcharColumn<N extends number>(
  length: N,
): ColumnTypeDescriptor & {
  readonly codecId: typeof SQL_VARCHAR_CODEC_ID;
  readonly nativeType: 'character varying';
  readonly typeParams: { readonly length: N };
  readonly type: (ctx: Ctx) => VarcharCodec<N>;
} {
  return {
    codecId: SQL_VARCHAR_CODEC_ID,
    nativeType: 'character varying',
    typeParams: { length },
    type: varcharCodecForLength(length),
  } as const;
}

export const int4Column = {
  codecId: PG_INT4_CODEC_ID,
  nativeType: 'int4',
} as const satisfies ColumnTypeDescriptor;

export const int2Column = {
  codecId: PG_INT2_CODEC_ID,
  nativeType: 'int2',
} as const satisfies ColumnTypeDescriptor;

export const int8Column = {
  codecId: PG_INT8_CODEC_ID,
  nativeType: 'int8',
} as const satisfies ColumnTypeDescriptor;

export const float4Column = {
  codecId: PG_FLOAT4_CODEC_ID,
  nativeType: 'float4',
} as const satisfies ColumnTypeDescriptor;

export const float8Column = {
  codecId: PG_FLOAT8_CODEC_ID,
  nativeType: 'float8',
} as const satisfies ColumnTypeDescriptor;

export function numericColumn<P extends number, S extends number | undefined = undefined>(
  precision: P,
  scale?: S,
): ColumnTypeDescriptor & {
  readonly codecId: typeof PG_NUMERIC_CODEC_ID;
  readonly nativeType: 'numeric';
  readonly typeParams: S extends number
    ? { readonly precision: P; readonly scale: S }
    : { readonly precision: P };
  readonly type: (ctx: Ctx) => NumericCodec<P, S>;
} {
  // The runtime descriptor object intentionally omits `scale` when undefined so
  // the emitted contract.json matches the M0.3 baseline for `numeric(P)`-only
  // calls; the type-level `typeParams` shape parameterizes on `S`.
  const typeParams =
    scale === undefined
      ? ({ precision } as { readonly precision: P })
      : ({ precision, scale } as { readonly precision: P; readonly scale: S });
  return {
    codecId: PG_NUMERIC_CODEC_ID,
    nativeType: 'numeric',
    // The conditional shape on the return type is satisfied by either branch.
    typeParams: typeParams as never,
    type: numericCodecForParams(precision, scale),
  } as const;
}

// Static (no-precision) timestamp variants. Carry the un-parameterized factory
// in `type` so M2's resolver still resolves the column to the brand
// (`Timestamp` / `Timestamptz`) rather than falling through to the codec base.
export const timestampColumn = {
  codecId: PG_TIMESTAMP_CODEC_ID,
  nativeType: 'timestamp',
  type: timestampCodecForPrecision<undefined>(undefined),
} as const satisfies ColumnTypeDescriptor;

export const timestamptzColumn = {
  codecId: PG_TIMESTAMPTZ_CODEC_ID,
  nativeType: 'timestamptz',
  type: timestamptzCodecForPrecision<undefined>(undefined),
} as const satisfies ColumnTypeDescriptor;

export function timeColumn<P extends number | undefined = undefined>(
  precision?: P,
): ColumnTypeDescriptor & {
  readonly codecId: typeof PG_TIME_CODEC_ID;
  readonly nativeType: 'time';
  readonly type: (ctx: Ctx) => TimeCodec<P>;
} {
  return {
    codecId: PG_TIME_CODEC_ID,
    nativeType: 'time',
    ...(precision === undefined ? {} : { typeParams: { precision } }),
    type: timeCodecForPrecision(precision as P),
  } as const;
}

export function timetzColumn<P extends number | undefined = undefined>(
  precision?: P,
): ColumnTypeDescriptor & {
  readonly codecId: typeof PG_TIMETZ_CODEC_ID;
  readonly nativeType: 'timetz';
  readonly type: (ctx: Ctx) => TimetzCodec<P>;
} {
  return {
    codecId: PG_TIMETZ_CODEC_ID,
    nativeType: 'timetz',
    ...(precision === undefined ? {} : { typeParams: { precision } }),
    type: timetzCodecForPrecision(precision as P),
  } as const;
}

export const boolColumn = {
  codecId: PG_BOOL_CODEC_ID,
  nativeType: 'bool',
} as const satisfies ColumnTypeDescriptor;

export function bitColumn<N extends number>(
  length: N,
): ColumnTypeDescriptor & {
  readonly codecId: typeof PG_BIT_CODEC_ID;
  readonly nativeType: 'bit';
  readonly typeParams: { readonly length: N };
  readonly type: (ctx: Ctx) => BitCodec<N>;
} {
  return {
    codecId: PG_BIT_CODEC_ID,
    nativeType: 'bit',
    typeParams: { length },
    type: bitCodecForLength(length),
  } as const;
}

export function varbitColumn<N extends number>(
  length: N,
): ColumnTypeDescriptor & {
  readonly codecId: typeof PG_VARBIT_CODEC_ID;
  readonly nativeType: 'bit varying';
  readonly typeParams: { readonly length: N };
  readonly type: (ctx: Ctx) => VarBitCodec<N>;
} {
  return {
    codecId: PG_VARBIT_CODEC_ID,
    nativeType: 'bit varying',
    typeParams: { length },
    type: varbitCodecForLength(length),
  } as const;
}

export function intervalColumn<P extends number | undefined = undefined>(
  precision?: P,
): ColumnTypeDescriptor & {
  readonly codecId: typeof PG_INTERVAL_CODEC_ID;
  readonly nativeType: 'interval';
  readonly type: (ctx: Ctx) => IntervalCodec<P>;
} {
  return {
    codecId: PG_INTERVAL_CODEC_ID,
    nativeType: 'interval',
    ...(precision === undefined ? {} : { typeParams: { precision } }),
    type: intervalCodecForPrecision(precision as P),
  } as const;
}

/**
 * Static raw-JSONB column descriptor. Used for JSON columns whose payload
 * is not validated against any schema — encode/decode are JSON identity.
 *
 * For schema-validated JSON columns, use a per-library extension:
 * `arktypeJson(schema)` from `@prisma-next/extension-arktype-json/column-types`.
 * Future libraries (zod, valibot) will ship parallel column-author factories
 * with their own codec ids and serialize/rehydrate pipelines.
 *
 * Per Phase 4 of codec-registry-unification, the postgres adapter no longer
 * ships a schema-typed `json(schema)` / `jsonb(schema)` factory: the
 * generic Standard-Schema-driven design proved lossy for narrowed types
 * (custom narrows, branded types, …) and produced surprising behavior
 * for any library beyond the JSON Schema subset. Per-library extensions
 * are the cleaner answer.
 */
export const jsonColumn = {
  codecId: PG_JSON_CODEC_ID,
  nativeType: 'json',
  type: pgJsonValueFactory,
} as const satisfies ColumnTypeDescriptor;

export const jsonbColumn = {
  codecId: PG_JSONB_CODEC_ID,
  nativeType: 'jsonb',
  type: pgJsonbValueFactory,
} as const satisfies ColumnTypeDescriptor;

/**
 * Raw-JSONB column factory. Returns the bare {@link jsonColumn} descriptor;
 * payload is unvalidated. For schema-validated JSON columns, use
 * `arktypeJson(schema)` from `@prisma-next/extension-arktype-json`.
 */
export function json(): ColumnTypeDescriptor {
  return jsonColumn;
}

/**
 * Raw-JSONB column factory. Returns the bare {@link jsonbColumn} descriptor;
 * payload is unvalidated. For schema-validated JSON columns, use
 * `arktypeJson(schema)` from `@prisma-next/extension-arktype-json`.
 */
export function jsonb(): ColumnTypeDescriptor {
  return jsonbColumn;
}

export function enumType<const Values extends readonly string[]>(
  name: string,
  values: Values,
): StorageTypeInstance & { readonly typeParams: { readonly values: Values } } {
  return {
    codecId: PG_ENUM_CODEC_ID,
    nativeType: name,
    typeParams: { values },
  } as const;
}

export function enumColumn<TypeName extends string>(
  typeName: TypeName,
  nativeType: string,
): ColumnTypeDescriptor & { readonly typeRef: TypeName } {
  return {
    codecId: PG_ENUM_CODEC_ID,
    nativeType,
    typeRef: typeName,
  };
}
