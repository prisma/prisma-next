/**
 * Column type descriptors for Postgres adapter.
 *
 * These descriptors provide both codecId and nativeType for use in contract authoring.
 * They are derived from the same source of truth as codec definitions and manifests.
 */

import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import type { StorageTypeInstance } from '@prisma-next/sql-contract/types';

export const textColumn: ColumnTypeDescriptor = {
  codecId: 'pg/text@1',
  nativeType: 'text',
} as const;

export function charColumn(length: number): ColumnTypeDescriptor & {
  readonly typeParams: { readonly length: number };
} {
  return {
    codecId: 'pg/char@1',
    nativeType: 'character',
    typeParams: { length },
  } as const;
}

export function varcharColumn(length: number): ColumnTypeDescriptor & {
  readonly typeParams: { readonly length: number };
} {
  return {
    codecId: 'pg/varchar@1',
    nativeType: 'character varying',
    typeParams: { length },
  } as const;
}

export const int4Column: ColumnTypeDescriptor = {
  codecId: 'pg/int4@1',
  nativeType: 'int4',
} as const;

export const int2Column: ColumnTypeDescriptor = {
  codecId: 'pg/int2@1',
  nativeType: 'int2',
} as const;

export const int8Column: ColumnTypeDescriptor = {
  codecId: 'pg/int8@1',
  nativeType: 'int8',
} as const;

export const float4Column: ColumnTypeDescriptor = {
  codecId: 'pg/float4@1',
  nativeType: 'float4',
} as const;

export const float8Column: ColumnTypeDescriptor = {
  codecId: 'pg/float8@1',
  nativeType: 'float8',
} as const;

export function numericColumn(
  precision: number,
  scale?: number,
): ColumnTypeDescriptor & {
  readonly typeParams: { readonly precision: number; readonly scale?: number };
} {
  return {
    codecId: 'pg/numeric@1',
    nativeType: 'numeric',
    typeParams: scale === undefined ? { precision } : { precision, scale },
  } as const;
}

export const timestampColumn: ColumnTypeDescriptor = {
  codecId: 'pg/timestamp@1',
  nativeType: 'timestamp',
} as const;

export const timestamptzColumn: ColumnTypeDescriptor = {
  codecId: 'pg/timestamptz@1',
  nativeType: 'timestamptz',
} as const;

export function timeColumn(precision?: number): ColumnTypeDescriptor & {
  readonly typeParams?: { readonly precision: number };
} {
  return {
    codecId: 'pg/time@1',
    nativeType: 'time',
    ...(precision === undefined ? {} : { typeParams: { precision } }),
  } as const;
}

export function timetzColumn(precision?: number): ColumnTypeDescriptor & {
  readonly typeParams?: { readonly precision: number };
} {
  return {
    codecId: 'pg/timetz@1',
    nativeType: 'timetz',
    ...(precision === undefined ? {} : { typeParams: { precision } }),
  } as const;
}

export const boolColumn: ColumnTypeDescriptor = {
  codecId: 'pg/bool@1',
  nativeType: 'bool',
} as const;

export function bitColumn(length: number): ColumnTypeDescriptor & {
  readonly typeParams: { readonly length: number };
} {
  return {
    codecId: 'pg/bit@1',
    nativeType: 'bit',
    typeParams: { length },
  } as const;
}

export function varbitColumn(length: number): ColumnTypeDescriptor & {
  readonly typeParams: { readonly length: number };
} {
  return {
    codecId: 'pg/varbit@1',
    nativeType: 'bit varying',
    typeParams: { length },
  } as const;
}

export function intervalColumn(precision?: number): ColumnTypeDescriptor & {
  readonly typeParams?: { readonly precision: number };
} {
  return {
    codecId: 'pg/interval@1',
    nativeType: 'interval',
    ...(precision === undefined ? {} : { typeParams: { precision } }),
  } as const;
}

export function enumType<const Values extends readonly string[]>(
  name: string,
  values: Values,
): StorageTypeInstance & { readonly typeParams: { readonly values: Values } } {
  return {
    codecId: 'pg/enum@1',
    nativeType: name,
    typeParams: { values },
  } as const;
}

export function enumColumn<TypeName extends string>(
  typeName: TypeName,
  nativeType: string,
): ColumnTypeDescriptor & { readonly typeRef: TypeName } {
  return {
    codecId: 'pg/enum@1',
    nativeType,
    typeRef: typeName,
  };
}
