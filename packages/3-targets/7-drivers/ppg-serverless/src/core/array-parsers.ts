import type { ValueParser } from '@prisma/ppg';
import * as postgresArray from 'postgres-array';

// `[array OID, element OID]` for the scalars `defaultClientConfig` already
// parses. Mirrors `pg`'s built-in array decoder set so `text[]` / `int4[]` /
// `jsonb[]` etc. land as JS arrays at the framework adapter, not as the raw
// Postgres text form `'{a,b,c}'`.
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
 * Extend a `ValueParser` table with array variants for the scalar OIDs above.
 * Scalars without a known array counterpart, and array OIDs whose element
 * parser is missing from `parsers`, are silently skipped.
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
