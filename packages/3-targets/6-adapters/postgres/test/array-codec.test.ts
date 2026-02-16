import type { Codec } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  createArrayCodec,
  formatPgTextArray,
  parsePgTextArray,
  pgArrayCodec,
} from '../src/core/array-codec';
import { PG_ARRAY_CODEC_ID } from '../src/core/codec-ids';

describe('parsePgTextArray', () => {
  it('parses empty array', () => {
    expect(parsePgTextArray('{}')).toEqual([]);
  });

  it('parses single unquoted element', () => {
    expect(parsePgTextArray('{42}')).toEqual(['42']);
  });

  it('parses multiple unquoted elements', () => {
    expect(parsePgTextArray('{1,2,3}')).toEqual(['1', '2', '3']);
  });

  it('parses NULL elements', () => {
    expect(parsePgTextArray('{NULL}')).toEqual([null]);
  });

  it('parses mixed NULL and value elements', () => {
    expect(parsePgTextArray('{1,NULL,3}')).toEqual(['1', null, '3']);
  });

  it('parses quoted element with spaces', () => {
    expect(parsePgTextArray('{"hello world"}')).toEqual(['hello world']);
  });

  it('parses quoted element with commas', () => {
    expect(parsePgTextArray('{"has,comma",plain}')).toEqual(['has,comma', 'plain']);
  });

  it('parses quoted element with escaped quotes', () => {
    expect(parsePgTextArray('{"say \\"hello\\""}')).toEqual(['say "hello"']);
  });

  it('parses quoted element with escaped backslash', () => {
    expect(parsePgTextArray('{"path\\\\dir"}')).toEqual(['path\\dir']);
  });

  it('parses empty quoted string', () => {
    expect(parsePgTextArray('{""}')).toEqual(['']);
  });

  it('parses mixed quoted and unquoted elements', () => {
    expect(parsePgTextArray('{simple,"has,comma","with \\"quotes\\"",plain}')).toEqual([
      'simple',
      'has,comma',
      'with "quotes"',
      'plain',
    ]);
  });

  it('throws for invalid input without braces', () => {
    expect(() => parsePgTextArray('1,2,3')).toThrow('Invalid Postgres array literal');
  });

  it('throws for input missing opening brace', () => {
    expect(() => parsePgTextArray('1,2}')).toThrow('Invalid Postgres array literal');
  });
});

describe('formatPgTextArray', () => {
  it('formats empty array', () => {
    expect(formatPgTextArray([])).toBe('{}');
  });

  it('formats simple values', () => {
    expect(formatPgTextArray(['1', '2', '3'])).toBe('{1,2,3}');
  });

  it('formats null values as NULL', () => {
    expect(formatPgTextArray([null])).toBe('{NULL}');
  });

  it('formats mixed null and string values', () => {
    expect(formatPgTextArray(['1', null, '3'])).toBe('{1,NULL,3}');
  });

  it('quotes values containing spaces', () => {
    expect(formatPgTextArray(['hello world'])).toBe('{"hello world"}');
  });

  it('quotes values containing commas', () => {
    expect(formatPgTextArray(['a,b'])).toBe('{"a,b"}');
  });

  it('quotes and escapes values containing double quotes', () => {
    expect(formatPgTextArray(['say "hi"'])).toBe('{"say \\"hi\\""}');
  });

  it('quotes and escapes values containing backslashes', () => {
    expect(formatPgTextArray(['path\\dir'])).toBe('{"path\\\\dir"}');
  });

  it('quotes empty strings', () => {
    expect(formatPgTextArray([''])).toBe('{""}');
  });

  it('quotes values containing braces', () => {
    expect(formatPgTextArray(['{nested}'])).toBe('{"{nested}"}');
  });
});

describe('formatPgTextArray and parsePgTextArray roundtrip', () => {
  it.each([
    { values: [] },
    { values: ['1', '2', '3'] },
    { values: [null, 'a', null] },
    { values: ['hello world', 'has,comma', 'with "quotes"'] },
    { values: ['', 'path\\dir', '{braces}'] },
  ])('roundtrips $values', ({ values }) => {
    expect(parsePgTextArray(formatPgTextArray(values))).toEqual(values);
  });
});

describe('createArrayCodec', () => {
  const int4Codec: Codec<'pg/int4@1', string, number> = {
    id: 'pg/int4@1',
    targetTypes: ['int4'],
    decode: (wire) => Number(wire),
    encode: (value) => String(value),
  };

  const textCodec: Codec<'pg/text@1', string, string> = {
    id: 'pg/text@1',
    targetTypes: ['text'],
    decode: (wire) => wire,
  };

  it('has the array codec ID', () => {
    const arrayCodec = createArrayCodec(int4Codec);
    expect(arrayCodec.id).toBe(PG_ARRAY_CODEC_ID);
  });

  describe('decode', () => {
    it('decodes a pre-parsed JS array via element codec', () => {
      const arrayCodec = createArrayCodec(int4Codec);
      expect(arrayCodec.decode(['1', '2', '3'])).toEqual([1, 2, 3]);
    });

    it('decodes a Postgres text array string via element codec', () => {
      const arrayCodec = createArrayCodec(int4Codec);
      expect(arrayCodec.decode('{1,2,3}')).toEqual([1, 2, 3]);
    });

    it('preserves null elements during decode', () => {
      const arrayCodec = createArrayCodec(int4Codec);
      expect(arrayCodec.decode([null, '2', null])).toEqual([null, 2, null]);
    });

    it('decodes text array with NULL elements', () => {
      const arrayCodec = createArrayCodec(int4Codec);
      expect(arrayCodec.decode('{1,NULL,3}')).toEqual([1, null, 3]);
    });

    it('decodes empty array', () => {
      const arrayCodec = createArrayCodec(int4Codec);
      expect(arrayCodec.decode([])).toEqual([]);
    });

    it('decodes empty text array string', () => {
      const arrayCodec = createArrayCodec(int4Codec);
      expect(arrayCodec.decode('{}')).toEqual([]);
    });
  });

  describe('encode', () => {
    it('encodes array elements via element codec', () => {
      const arrayCodec = createArrayCodec(int4Codec);
      expect(arrayCodec.encode!([1, 2, 3])).toEqual(['1', '2', '3']);
    });

    it('preserves null elements during encode', () => {
      const arrayCodec = createArrayCodec(int4Codec);
      expect(arrayCodec.encode!([1, null, 3])).toEqual(['1', null, '3']);
    });

    it('omits encode when element codec has no encode', () => {
      const arrayCodec = createArrayCodec(textCodec);
      expect(arrayCodec.encode).toBeUndefined();
    });
  });
});

describe('pgArrayCodec', () => {
  it('has the correct codec ID', () => {
    expect(pgArrayCodec.id).toBe(PG_ARRAY_CODEC_ID);
  });

  it('has a params schema', () => {
    expect(pgArrayCodec.paramsSchema).toBeDefined();
  });

  it('decodes pre-parsed JS array as-is', () => {
    expect(pgArrayCodec.decode([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('decodes text array string', () => {
    expect(pgArrayCodec.decode('{a,b,c}')).toEqual(['a', 'b', 'c']);
  });

  it('wraps non-array non-string value', () => {
    expect(pgArrayCodec.decode(42)).toEqual([42]);
  });

  it('encodes as identity (passthrough)', () => {
    const input = [1, 2, 3];
    expect(pgArrayCodec.encode!(input)).toBe(input);
  });
});
