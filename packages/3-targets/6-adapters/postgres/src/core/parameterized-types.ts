/**
 * Shared utility for expanding parameterized Postgres types to their full SQL representation.
 *
 * This module provides a single source of truth for type expansion logic, used by:
 * - Schema verification (verify-sql-schema.ts) via the expandNativeType codec control hook
 * - Migration planner (planner.ts) via direct import
 *
 * @module
 */

import {
  PG_ARRAY_CODEC_ID,
  PG_BIT_CODEC_ID,
  PG_CHAR_CODEC_ID,
  PG_INTERVAL_CODEC_ID,
  PG_NUMERIC_CODEC_ID,
  PG_TIME_CODEC_ID,
  PG_TIMESTAMP_CODEC_ID,
  PG_TIMESTAMPTZ_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
  PG_VARBIT_CODEC_ID,
  PG_VARCHAR_CODEC_ID,
  SQL_CHAR_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
} from './codec-ids';

/**
 * Input for expanding parameterized native types.
 */
export interface ExpandNativeTypeInput {
  readonly nativeType: string;
  readonly codecId?: string;
  readonly typeParams?: Record<string, unknown>;
}

/** Set of codec IDs that use the 'length' parameter */
const LENGTH_CODEC_IDS: Set<string> = new Set([
  SQL_CHAR_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
  PG_CHAR_CODEC_ID,
  PG_VARCHAR_CODEC_ID,
  PG_BIT_CODEC_ID,
  PG_VARBIT_CODEC_ID,
]);

/** Set of codec IDs that use the 'precision' parameter for temporal types */
const TEMPORAL_PRECISION_CODEC_IDS: Set<string> = new Set([
  PG_TIMESTAMP_CODEC_ID,
  PG_TIMESTAMPTZ_CODEC_ID,
  PG_TIME_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
  PG_INTERVAL_CODEC_ID,
]);

/**
 * Validates that a value is a valid type parameter number.
 * Type parameters must be finite, non-negative integers.
 */
function isValidTypeParamNumber(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
  );
}

/**
 * Expands a parameterized native type to its full SQL representation.
 *
 * For example:
 * - { nativeType: 'character varying', typeParams: { length: 255 } } -> 'character varying(255)'
 * - { nativeType: 'numeric', typeParams: { precision: 10, scale: 2 } } -> 'numeric(10,2)'
 * - { nativeType: 'timestamp without time zone', typeParams: { precision: 3 } } -> 'timestamp without time zone(3)'
 *
 * Returns the original nativeType if:
 * - No typeParams are provided
 * - No codecId is provided
 * - The codecId is not a known parameterized type
 * - The typeParams values are invalid
 */
export function expandParameterizedNativeType(input: ExpandNativeTypeInput): string {
  const { nativeType, codecId, typeParams } = input;

  if (!typeParams || !codecId) {
    return nativeType;
  }

  // Length-parameterized types: char, varchar, bit, varbit
  if (LENGTH_CODEC_IDS.has(codecId)) {
    const length = typeParams['length'];
    if (isValidTypeParamNumber(length)) {
      return `${nativeType}(${length})`;
    }
    return nativeType;
  }

  // Numeric with precision and optional scale
  if (codecId === PG_NUMERIC_CODEC_ID) {
    const precision = typeParams['precision'];
    const scale = typeParams['scale'];

    if (isValidTypeParamNumber(precision)) {
      if (isValidTypeParamNumber(scale)) {
        return `${nativeType}(${precision},${scale})`;
      }
      return `${nativeType}(${precision})`;
    }
    return nativeType;
  }

  // Temporal types with precision: timestamp, timestamptz, time, timetz, interval
  if (TEMPORAL_PRECISION_CODEC_IDS.has(codecId)) {
    const precision = typeParams['precision'];
    if (isValidTypeParamNumber(precision)) {
      return `${nativeType}(${precision})`;
    }
    return nativeType;
  }

  // Array types: nativeType is already the expanded form (e.g., 'int4[]')
  // but if we only have the element info, construct it
  if (codecId === PG_ARRAY_CODEC_ID) {
    const elementNativeType = typeParams['elementNativeType'];
    if (typeof elementNativeType === 'string') {
      return `${elementNativeType}[]`;
    }
    // nativeType should already end with '[]'
    return nativeType;
  }

  return nativeType;
}
