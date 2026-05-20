/**
 * Shared encode/decode/render constants for the Postgres target codecs.
 *
 * The codec implementations live in `codecs.ts` (TML-2357). This file retains the conversion helpers + emit-path type renderers that the codec methods compose with — keeping a single source of truth for non-trivial conversions while the codec methods provide the framework-required `Promise<…>` boundary.
 *
 * Trivial identity passthroughs are inlined directly in the codec methods; only conversions with shape (custom JSON round-trip, decode normalisation, parameterised renderers) live here.
 */

import type { JsonValue } from '@prisma-next/contract/types';
import type { AnyCodecDescriptor } from '@prisma-next/framework-components/codec';

/**
 * Escape a string value for embedding in a Postgres single-quoted SQL literal.
 *
 * Doubles embedded single quotes (`O'Brien` -> `O''Brien`). Rejects embedded NULL bytes — Postgres truncates UTF-8 strings at the first `\0` byte, so silently passing one through would yield a corrupted literal. Backslashes pass through as literal characters because the runtime assumes `standard_conforming_strings = on` (Postgres default since 9.1).
 *
 * Returns the inner content without the surrounding quotes; callers concatenate them.
 */
export function escapePgLiteralBody(value: string): string {
  if (value.includes('\0')) {
    throw new Error('Postgres literal cannot contain NULL bytes');
  }
  return value.replace(/'/g, "''");
}

/**
 * Read the Postgres-native type name (e.g. `'integer'`, `'jsonb'`, `'timestamp with time zone'`) recorded on a codec descriptor's `meta` slot. Returns `undefined` if the descriptor carries no Postgres native-type meta — callers that need a cast then fall back to emitting a bare quoted literal and rely on Postgres's column-context inference.
 */
export function readPgNativeType(descriptor: AnyCodecDescriptor): string | undefined {
  const meta = descriptor.meta as
    | { readonly db?: { readonly sql?: { readonly postgres?: { readonly nativeType?: string } } } }
    | undefined;
  return meta?.db?.sql?.postgres?.nativeType;
}

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
  if (scale === undefined) return `Numeric<${precision}>`;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || !Number.isInteger(scale)) {
    throw new Error(
      `renderOutputType: expected integer "scale" in typeParams for Numeric, got ${String(scale)}`,
    );
  }
  return `Numeric<${precision}, ${scale}>`;
};

// ISO 8601 UTC: `YYYY-MM-DDTHH:MM:SS[.mmm…]Z`. Trailing `Z` is required; fractional seconds are optional. Other `Date`-parseable formats (`January 15, 2024`, `01/15/2024`, etc.) are intentionally rejected because those formats are implementation-defined and not the documented contract for `pg/timestamp@1` / `pg/timestamptz@1`.
const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

export const pgTimestampEncodeJson = (value: Date): JsonValue => value.toISOString();
export const pgTimestampDecodeJson = (json: JsonValue): Date => {
  if (typeof json !== 'string') {
    throw new Error(`Expected ISO date string for pg/timestamp@1, got ${typeof json}`);
  }
  if (!ISO_8601_UTC.test(json)) {
    throw new Error(`Invalid ISO date string for pg/timestamp@1: ${json}`);
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
  if (!ISO_8601_UTC.test(json)) {
    throw new Error(`Invalid ISO date string for pg/timestamptz@1: ${json}`);
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
  if (!values.every((v): v is string => typeof v === 'string')) {
    throw new Error(`renderOutputType: expected string[] "values" in typeParams for enum`);
  }
  return values
    .map((value) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
    .join(' | ');
};

export const pgJsonEncode = (value: string | JsonValue): string => JSON.stringify(value);
export const pgJsonDecode = (wire: string | JsonValue): JsonValue =>
  typeof wire === 'string' ? JSON.parse(wire) : wire;

export const pgJsonbEncode = (value: string | JsonValue): string => JSON.stringify(value);
export const pgJsonbDecode = (wire: string | JsonValue): JsonValue =>
  typeof wire === 'string' ? JSON.parse(wire) : wire;
