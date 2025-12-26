/**
 * Column type descriptors for Postgres adapter.
 *
 * These descriptors provide both codecId and nativeType for use in contract authoring.
 * They are derived from the same source of truth as codec definitions and manifests.
 */

import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';

export const textColumn: ColumnTypeDescriptor = {
  codecId: 'pg/text@1',
  nativeType: 'text',
} as const;

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

export const timestampColumn: ColumnTypeDescriptor = {
  codecId: 'pg/timestamp@1',
  nativeType: 'timestamp',
} as const;

export const timestamptzColumn: ColumnTypeDescriptor = {
  codecId: 'pg/timestamptz@1',
  nativeType: 'timestamptz',
} as const;

export const boolColumn: ColumnTypeDescriptor = {
  codecId: 'pg/bool@1',
  nativeType: 'bool',
} as const;
