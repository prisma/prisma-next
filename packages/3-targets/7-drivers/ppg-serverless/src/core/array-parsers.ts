import type { ValueParser } from '@prisma/ppg';
import * as postgresArray from 'postgres-array';

/**
 * PostgreSQL OIDs for the array variants of the scalar types that
 * `@prisma/ppg`'s `defaultClientConfig` already registers parsers for.
 * Each entry pairs an array OID with the OID of its element type so
 * the array parser can re-use the existing element-type parser.
 *
 * The set mirrors the array OIDs `pg`'s built-in type registry handles
 * via the same `postgres-array` decoder. The framework's
 * `parseContractMarkerRow` expects `text[]` to surface as a JS array;
 * any user query reading `int4[]` / `uuid[]` / `jsonb[]` columns has
 * the same expectation. PPG ships scalar-only parsers, so without
 * this extension array columns flow through as their raw Postgres
 * text-format string (`'{a,b,c}'`) instead of `['a','b','c']`.
 */
const ARRAY_OID_TO_ELEMENT_OID: ReadonlyMap<number, number> = new Map([
  [1000, 16], // _bool   -> bool
  [1005, 21], // _int2   -> int2
  [1007, 23], // _int4   -> int4
  [1016, 20], // _int8   -> int8
  [1021, 700], // _float4 -> float4
  [1022, 701], // _float8 -> float8
  [1009, 25], // _text   -> text
  [1015, 1043], // _varchar -> varchar
  [199, 114], // _json   -> json
  [3807, 3802], // _jsonb  -> jsonb
]);

/**
 * Extend a `ValueParser` table (typically the one from
 * `defaultClientConfig(url).parsers`) with array variants for every
 * scalar OID present in the input that has a known array OID
 * counterpart. The original parsers pass through unchanged; the
 * appended entries decode the Postgres array text format via
 * `postgres-array.parse` and apply the matching element parser per
 * element.
 *
 * Scalar OIDs without a known array counterpart, or array OIDs whose
 * element parser is missing from the input, are silently skipped.
 * A NULL array column surfaces as JS `null`; a NULL element inside
 * a non-null array surfaces as JS `null` in its slot (handled by
 * `postgres-array` itself, which short-circuits the literal `NULL`
 * token before calling the element transform).
 */
export function withArrayParsers(
  parsers: ReadonlyArray<ValueParser<unknown>>,
): ValueParser<unknown>[] {
  const byOid = new Map<number, ValueParser<unknown>>();
  for (const parser of parsers) {
    byOid.set(parser.oid, parser);
  }

  const arrayParsers: ValueParser<unknown>[] = [];
  for (const [arrayOid, elementOid] of ARRAY_OID_TO_ELEMENT_OID) {
    const elementParser = byOid.get(elementOid);
    if (elementParser === undefined) {
      continue;
    }
    arrayParsers.push({
      oid: arrayOid,
      parse: (value: string | null) => {
        if (value === null) {
          return null;
        }
        return postgresArray.parse(value, (element: string) => elementParser.parse(element));
      },
    });
  }

  return [...parsers, ...arrayParsers];
}
