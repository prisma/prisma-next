/**
 * Shared encode/decode/render constants and codec id literals for the six SQL base codecs (`sql/char@1`, `sql/varchar@1`, `sql/int@1`, `sql/float@1`, `sql/text@1`, `sql/timestamp@1`).
 *
 * The codec implementations live in `sql-codecs.ts` (TML-2357). This module retains only the conversion helpers + emit-path renderers the codec methods compose with — keeping a single source of truth for non-trivial conversions while the codec methods provide the framework-required `Promise<…>` boundary.
 */

import type { JsonValue } from '@prisma-next/contract/types';

export const SQL_CHAR_CODEC_ID = 'sql/char@1' as const;
export const SQL_VARCHAR_CODEC_ID = 'sql/varchar@1' as const;
export const SQL_INT_CODEC_ID = 'sql/int@1' as const;
export const SQL_FLOAT_CODEC_ID = 'sql/float@1' as const;
export const SQL_TEXT_CODEC_ID = 'sql/text@1' as const;
export const SQL_TIMESTAMP_CODEC_ID = 'sql/timestamp@1' as const;

export const sqlCharEncode = (value: string): string => value;
export const sqlCharDecode = (wire: string): string => wire.trimEnd();
export const sqlCharRenderOutputType = (typeParams: { readonly length?: number }) => {
  const length = typeParams.length;
  if (length === undefined) return undefined;
  if (typeof length !== 'number' || !Number.isFinite(length) || !Number.isInteger(length)) {
    throw new Error(
      `renderOutputType: expected integer "length" in typeParams for Char, got ${String(length)}`,
    );
  }
  return `Char<${length}>`;
};

export const sqlVarcharEncode = (value: string): string => value;
export const sqlVarcharDecode = (wire: string): string => wire;
export const sqlVarcharRenderOutputType = (typeParams: { readonly length?: number }) => {
  const length = typeParams.length;
  if (length === undefined) return undefined;
  if (typeof length !== 'number' || !Number.isFinite(length) || !Number.isInteger(length)) {
    throw new Error(
      `renderOutputType: expected integer "length" in typeParams for Varchar, got ${String(length)}`,
    );
  }
  return `Varchar<${length}>`;
};

export const sqlIntEncode = (value: number): number => value;
export const sqlIntDecode = (wire: number): number => wire;

export const sqlFloatEncode = (value: number): number => value;
export const sqlFloatDecode = (wire: number): number => wire;

export const sqlTextEncode = (value: string): string => value;
export const sqlTextDecode = (wire: string): string => wire;

export const sqlTimestampEncode = (value: Date): Date => value;
export const sqlTimestampDecode = (wire: Date): Date => wire;
export const sqlTimestampEncodeJson = (value: Date): JsonValue => value.toISOString();
export const sqlTimestampDecodeJson = (json: JsonValue): Date => {
  if (typeof json !== 'string') {
    throw new Error(`Expected ISO date string for sql/timestamp@1, got ${typeof json}`);
  }
  const date = new Date(json);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO date string for sql/timestamp@1: ${json}`);
  }
  return date;
};
export const sqlTimestampRenderOutputType = (typeParams: { readonly precision?: number }) => {
  const precision = typeParams.precision;
  if (precision === undefined) {
    return 'Timestamp';
  }
  if (
    typeof precision !== 'number' ||
    !Number.isFinite(precision) ||
    !Number.isInteger(precision)
  ) {
    throw new Error(
      `renderOutputType: expected integer "precision" in typeParams for Timestamp, got ${String(precision)}`,
    );
  }
  return `Timestamp<${precision}>`;
};
