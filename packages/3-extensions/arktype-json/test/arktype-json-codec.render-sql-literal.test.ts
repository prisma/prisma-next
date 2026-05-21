import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { arktypeJsonColumn } from '../src/core/arktype-json-codec';

const instanceCtx = { name: '<test>' };

describe('renderSqlLiteral on arktype/json@1', () => {
  it('renders schema-validated objects as quoted JSON literals with jsonb cast', () => {
    const codec = arktypeJsonColumn(type({ a: 'number' })).codecFactory(instanceCtx);
    expect(codec.renderSqlLiteral({ a: 1 })).toBe('\'{"a":1}\'::jsonb');
  });

  it('doubles embedded single quotes inside string fields', () => {
    const codec = arktypeJsonColumn(type({ msg: 'string' })).codecFactory(instanceCtx);
    expect(codec.renderSqlLiteral({ msg: "O'Brien" })).toBe('\'{"msg":"O\'\'Brien"}\'::jsonb');
  });

  it('handles arrays', () => {
    const codec = arktypeJsonColumn(type('number[]')).codecFactory(instanceCtx);
    expect(codec.renderSqlLiteral([1, 2, 3])).toBe("'[1,2,3]'::jsonb");
  });

  it('renders unicode through verbatim (JSON serialises non-ASCII as is by default)', () => {
    const codec = arktypeJsonColumn(type({ name: 'string' })).codecFactory(instanceCtx);
    expect(codec.renderSqlLiteral({ name: '日本語' })).toBe('\'{"name":"日本語"}\'::jsonb');
  });

  it('escapes NULL bytes via JSON unicode encoding (no raw \\0 leaks into the literal)', () => {
    const codec = arktypeJsonColumn(type({ msg: 'string' })).codecFactory(instanceCtx);
    const rendered = codec.renderSqlLiteral({ msg: 'a\0b' });
    expect(rendered).toBe('\'{"msg":"a\\u0000b"}\'::jsonb');
    expect(rendered.includes('\0')).toBe(false);
  });
});
