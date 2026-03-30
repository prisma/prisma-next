import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import {
  SQLITE_BIGINT_CODEC_ID,
  SQLITE_BLOB_CODEC_ID,
  SQLITE_BOOLEAN_CODEC_ID,
  SQLITE_DATETIME_CODEC_ID,
  SQLITE_INTEGER_CODEC_ID,
  SQLITE_JSON_CODEC_ID,
  SQLITE_REAL_CODEC_ID,
  SQLITE_TEXT_CODEC_ID,
} from '../core/codec-ids';

export const textColumn: ColumnTypeDescriptor = {
  codecId: SQLITE_TEXT_CODEC_ID,
  nativeType: 'text',
} as const;

export const integerColumn: ColumnTypeDescriptor = {
  codecId: SQLITE_INTEGER_CODEC_ID,
  nativeType: 'integer',
} as const;

export const realColumn: ColumnTypeDescriptor = {
  codecId: SQLITE_REAL_CODEC_ID,
  nativeType: 'real',
} as const;

export const blobColumn: ColumnTypeDescriptor = {
  codecId: SQLITE_BLOB_CODEC_ID,
  nativeType: 'blob',
} as const;

export const booleanColumn: ColumnTypeDescriptor = {
  codecId: SQLITE_BOOLEAN_CODEC_ID,
  nativeType: 'integer',
} as const;

export const datetimeColumn: ColumnTypeDescriptor = {
  codecId: SQLITE_DATETIME_CODEC_ID,
  nativeType: 'text',
} as const;

export const jsonColumn: ColumnTypeDescriptor = {
  codecId: SQLITE_JSON_CODEC_ID,
  nativeType: 'text',
} as const;

export const bigintColumn: ColumnTypeDescriptor = {
  codecId: SQLITE_BIGINT_CODEC_ID,
  nativeType: 'integer',
} as const;
