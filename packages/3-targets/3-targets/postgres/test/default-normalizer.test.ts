import { describe, expect, it } from 'vitest';
import { parsePostgresDefault } from '../src/core/default-normalizer';

describe('parsePostgresDefault array literals', () => {
  it('parses an empty array body', () => {
    expect(parsePostgresDefault("'{}'::text[]", 'text[]')).toEqual({
      kind: 'literal',
      value: [],
    });
  });

  it('parses a numeric array body', () => {
    expect(parsePostgresDefault("'{1,2}'::integer[]", 'integer[]')).toEqual({
      kind: 'literal',
      value: [1, 2],
    });
  });

  it('parses a quoted-string array body', () => {
    expect(parsePostgresDefault('\'{"a","b"}\'::text[]', 'text[]')).toEqual({
      kind: 'literal',
      value: ['a', 'b'],
    });
  });

  it('parses a NULL element', () => {
    expect(parsePostgresDefault("'{NULL}'::text[]", 'text[]')).toEqual({
      kind: 'literal',
      value: [null],
    });
  });

  it('parses boolean array body', () => {
    expect(parsePostgresDefault("'{true,false}'::boolean[]", 'boolean[]')).toEqual({
      kind: 'literal',
      value: [true, false],
    });
  });

  it('fails closed for ambiguous bool tokens t/f (no literal-array normalization)', () => {
    const result = parsePostgresDefault("'{t,f}'::boolean[]", 'boolean[]');
    expect(result?.kind).not.toBe('literal');
  });

  it('fails closed for an unquoted non-numeric element (no literal-array normalization)', () => {
    const result = parsePostgresDefault("'{hello world}'::text[]", 'text[]');
    expect(result?.kind).not.toBe('literal');
  });
});
