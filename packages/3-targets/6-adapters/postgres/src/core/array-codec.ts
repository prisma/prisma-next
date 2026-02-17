/**
 * Postgres array codec implementation.
 *
 * Provides:
 * - `parsePgTextArray()` — parses Postgres text array wire format `{elem1,elem2,NULL,...}`
 * - `formatPgTextArray()` — formats JS array to Postgres text array wire format
 * - `createArrayCodec()` — factory for element-aware array codecs
 * - `pgArrayCodec` — base codec for registration in the codec registry
 *
 * @module
 */

import type { Codec } from '@prisma-next/sql-relational-core/ast';
import { codec } from '@prisma-next/sql-relational-core/ast';
import { type as arktype } from 'arktype';
import { PG_ARRAY_CODEC_ID } from './codec-ids';

/**
 * Arktype schema for array codec type parameters.
 */
export const arrayParamsSchema = arktype({
  element: 'string',
  'nullableItems?': 'boolean',
  'elementNativeType?': 'string',
  'elementTypeParams?': 'Record<string, unknown>',
});

/** Characters that require quoting inside a Postgres text array literal. */
const NEEDS_QUOTING = /[{},"\\\s]/;

/**
 * Matches tokens inside a Postgres text array literal (between the outer braces):
 * - `"(?:[^"\\]|\\.)*"` — quoted element (may contain escaped chars)
 * - `[^,]+` — unquoted element (everything up to the next comma or end)
 */
const PG_ARRAY_TOKEN = /"(?:[^"\\]|\\.)*"|[^,]+/g;

/** Strips the surrounding quotes and unescapes `\"` and `\\` inside a quoted token. */
function unescapeQuoted(token: string): string {
  return token.slice(1, -1).replace(/\\(.)/g, '$1');
}

/**
 * Parses a Postgres text array literal into a JavaScript array of strings and nulls.
 *
 * Handles:
 * - Empty arrays: `{}` → `[]`
 * - NULL elements: `{NULL}` → `[null]`
 * - Quoted elements: `{"hello world","with \"quotes\""}` → `['hello world', 'with "quotes"']`
 * - Escaped characters inside quotes: `\\` → `\`, `\"` → `"`
 * - Unquoted elements: `{1,2,3}` → `['1', '2', '3']`
 *
 * @param wire - Postgres text array literal string
 * @returns Array of string values and nulls
 */
export function parsePgTextArray(wire: string): (string | null)[] {
  if (wire.length < 2 || wire[0] !== '{' || wire[wire.length - 1] !== '}') {
    throw new Error(`Invalid Postgres array literal: expected '{...}', got: ${wire.slice(0, 50)}`);
  }

  const inner = wire.slice(1, -1);
  if (inner === '') {
    return [];
  }

  PG_ARRAY_TOKEN.lastIndex = 0;
  const result: (string | null)[] = [];

  for (let match = PG_ARRAY_TOKEN.exec(inner); match !== null; match = PG_ARRAY_TOKEN.exec(inner)) {
    const token = match[0];
    if (token[0] === '"') {
      result.push(unescapeQuoted(token));
    } else if (token === 'NULL') {
      result.push(null);
    } else {
      result.push(token);
    }
  }

  return result;
}

/**
 * Formats a JavaScript array into a Postgres text array literal.
 *
 * Handles:
 * - null values → `NULL` (unquoted)
 * - Values containing special characters → quoted with escaping
 * - Simple values → unquoted
 *
 * @param values - Array of string values and nulls
 * @returns Postgres text array literal string
 */
export function formatPgTextArray(values: (string | null)[]): string {
  const elements = values.map((value) => {
    if (value === null) {
      return 'NULL';
    }
    if (value === '' || value === 'NULL' || NEEDS_QUOTING.test(value)) {
      // Quote and escape
      return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return value;
  });
  return `{${elements.join(',')}}`;
}

/**
 * Creates an array codec that wraps an element codec for per-element encoding/decoding.
 *
 * The returned codec:
 * - **decode**: Parses wire value (text literal or pre-parsed array) and decodes each
 *   non-null element through the element codec
 * - **encode**: Encodes each non-null element through the element codec, returns a JS array
 *   (pg driver handles serialization to wire format)
 *
 * Type composition:
 * - Wire: `string | (TElementWire | null)[]` — text literal from Postgres, or pre-parsed array from pg driver
 * - JS: `(TElementJs | null)[]` — always a JS array where elements may be null
 *
 * @param elementCodec - The codec to use for individual array elements
 * @returns A new Codec instance for the array type
 */
export function createArrayCodec<TElementWire, TElementJs>(
  elementCodec: Codec<string, TElementWire, TElementJs>,
): Codec<typeof PG_ARRAY_CODEC_ID, string | (TElementWire | null)[], (TElementJs | null)[]> {
  return {
    id: PG_ARRAY_CODEC_ID,
    targetTypes: [],
    decode(wire: string | (TElementWire | null)[]) {
      const arr: (TElementWire | null)[] = Array.isArray(wire)
        ? wire
        : typeof wire === 'string'
          ? (parsePgTextArray(wire) as (TElementWire | null)[])
          : [wire as TElementWire];

      return arr.map((item) =>
        item === null || item === undefined ? null : elementCodec.decode(item),
      );
    },
    ...(elementCodec.encode
      ? {
          encode(value: (TElementJs | null)[]): (TElementWire | null)[] {
            return value.map((item) =>
              // biome-ignore lint/style/noNonNullAssertion: encode is guaranteed by outer check
              item === null || item === undefined ? null : elementCodec.encode!(item),
            );
          },
        }
      : {}),
  } as Codec<typeof PG_ARRAY_CODEC_ID, string | (TElementWire | null)[], (TElementJs | null)[]>;
}

/**
 * Base Postgres array codec.
 *
 * Registered in the codec registry as 'pg/array@1'. Handles the common case
 * where the pg driver returns arrays already parsed into JavaScript arrays.
 *
 * For element-level codec resolution (e.g., timestamp elements that need Date→string
 * conversion), the runtime creates specialized array codec instances via
 * `createArrayCodec()` during context creation.
 */
export const pgArrayCodec = codec<typeof PG_ARRAY_CODEC_ID, unknown, unknown[]>({
  typeId: PG_ARRAY_CODEC_ID,
  targetTypes: [],
  paramsSchema: arrayParamsSchema,
  encode: (value: unknown[]): unknown => value,
  decode: (wire: unknown): unknown[] => {
    if (Array.isArray(wire)) {
      return wire;
    }
    if (typeof wire === 'string') {
      return parsePgTextArray(wire);
    }
    return [wire];
  },
});
