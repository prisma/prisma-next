import type { ValueParser } from '@prisma/ppg';
import { describe, expect, it } from 'vitest';
import { withArrayParsers } from '../src/core/array-parsers';

// Element parsers mirroring the subset of `@prisma/ppg`'s default scalar
// parsers that this test cares about. Kept inline so the tests do not
// depend on PPG runtime internals — `withArrayParsers` only reads the
// `.parse` function via the published `ValueParser` contract.
const textParser: ValueParser<unknown> = { oid: 25, parse: (v) => v };
const int4Parser: ValueParser<unknown> = {
  oid: 23,
  parse: (v) => (v === null ? null : Number.parseInt(v, 10)),
};
const boolParser: ValueParser<unknown> = {
  oid: 16,
  parse: (v) => v === 't',
};

function lookup(parsers: ReadonlyArray<ValueParser<unknown>>, oid: number): ValueParser<unknown> {
  const parser = parsers.find((p) => p.oid === oid);
  if (!parser) throw new Error(`expected parser for oid ${oid}`);
  return parser;
}

describe('withArrayParsers', () => {
  it('preserves the original scalar parsers', () => {
    const extended = withArrayParsers([textParser, int4Parser, boolParser]);
    expect(extended).toEqual(expect.arrayContaining([textParser, int4Parser, boolParser]));
  });

  it('appends an array parser for each scalar with a known array OID', () => {
    const extended = withArrayParsers([textParser, int4Parser, boolParser]);
    expect(extended.map((p) => p.oid)).toEqual(
      expect.arrayContaining([
        25,
        23,
        16, // originals
        1009,
        1007,
        1000, // text[], int4[], bool[]
      ]),
    );
  });

  it('skips array OIDs whose element parser is missing', () => {
    const extended = withArrayParsers([textParser]); // no int4 / bool scalar
    const oids = extended.map((p) => p.oid);
    expect(oids).toContain(1009); // text[] still added
    expect(oids).not.toContain(1007); // int4[] skipped (no element parser)
    expect(oids).not.toContain(1000); // bool[] skipped (no element parser)
  });

  it('decodes a simple text[] (`{a,b,c}` -> ["a","b","c"])', () => {
    const arrParser = lookup(withArrayParsers([textParser]), 1009);
    expect(arrParser.parse('{a,b,c}')).toEqual(['a', 'b', 'c']);
  });

  it('decodes an empty text[] (`{}` -> [])', () => {
    const arrParser = lookup(withArrayParsers([textParser]), 1009);
    expect(arrParser.parse('{}')).toEqual([]);
  });

  it('surfaces NULL elements as JS null', () => {
    const arrParser = lookup(withArrayParsers([textParser]), 1009);
    expect(arrParser.parse('{a,NULL,b}')).toEqual(['a', null, 'b']);
  });

  it('decodes quoted elements containing the delimiter', () => {
    const arrParser = lookup(withArrayParsers([textParser]), 1009);
    expect(arrParser.parse('{"hello, world","a"}')).toEqual(['hello, world', 'a']);
  });

  it('applies the element parser to each entry (int4[] -> number[])', () => {
    const arrParser = lookup(withArrayParsers([int4Parser]), 1007);
    expect(arrParser.parse('{1,2,3}')).toEqual([1, 2, 3]);
  });

  it('applies the element parser per entry (bool[] -> boolean[])', () => {
    const arrParser = lookup(withArrayParsers([boolParser]), 1000);
    expect(arrParser.parse('{t,f,t}')).toEqual([true, false, true]);
  });

  it('passes a NULL column value through as JS null', () => {
    const arrParser = lookup(withArrayParsers([textParser]), 1009);
    expect(arrParser.parse(null)).toBeNull();
  });
});
