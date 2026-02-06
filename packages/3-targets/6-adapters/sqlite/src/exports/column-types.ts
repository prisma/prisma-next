/**
 * Column type descriptors for SQLite adapter.
 *
 * These descriptors provide both codecId and nativeType for use in contract authoring.
 */

import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';

export const textColumn: ColumnTypeDescriptor = {
  codecId: 'sqlite/text@1',
  nativeType: 'text',
} as const;

export const intColumn: ColumnTypeDescriptor = {
  codecId: 'sqlite/int@1',
  nativeType: 'integer',
} as const;

export const realColumn: ColumnTypeDescriptor = {
  codecId: 'sqlite/real@1',
  nativeType: 'real',
} as const;

// Store datetimes as TEXT (ISO string) for deterministic JS decode.
export const datetimeColumn: ColumnTypeDescriptor = {
  codecId: 'sqlite/datetime@1',
  nativeType: 'text',
} as const;

export const boolColumn: ColumnTypeDescriptor = {
  codecId: 'sqlite/bool@1',
  nativeType: 'integer',
} as const;
