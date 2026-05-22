import { describe, expect, it } from 'vitest';
import { ParamRef } from '../../src/exports/ast';
import { param } from '../../src/exports/expression';

describe('param', () => {
  it('returns a ParamRef', () => {
    const result = param('hello', { codecId: 'pg/text' });
    expect(result).toBeInstanceOf(ParamRef);
  });

  it('preserves the original value', () => {
    const result = param('hello', { codecId: 'pg/text' });
    expect(result.value).toBe('hello');
  });

  it('stamps the codecId onto the ParamRef codec', () => {
    const result = param('hello', { codecId: 'pg/text' });
    expect(result.codec).toEqual({ codecId: 'pg/text' });
  });

  it('matches the result of ParamRef.of with the same arguments', () => {
    const value = 'hello';
    const codecId = 'pg/text';
    const viaParam = param(value, { codecId });
    const viaOf = ParamRef.of(value, { codec: { codecId } });
    expect(viaParam.value).toBe(viaOf.value);
    expect(viaParam.codec).toEqual(viaOf.codec);
    expect(viaParam.name).toBe(viaOf.name);
  });

  it('is codec-agnostic — pg/int4', () => {
    const result = param(42, { codecId: 'pg/int4' });
    expect(result.codec?.codecId).toBe('pg/int4');
    expect(result.value).toBe(42);
  });

  it('is codec-agnostic — pg/int8', () => {
    const result = param(9007199254740993n, { codecId: 'pg/int8' });
    expect(result.codec?.codecId).toBe('pg/int8');
    expect(result.value).toBe(9007199254740993n);
  });

  it('is codec-agnostic — sqlite/integer', () => {
    const result = param(1, { codecId: 'sqlite/integer' });
    expect(result.codec?.codecId).toBe('sqlite/integer');
    expect(result.value).toBe(1);
  });

  it('codec round-trips — codec.codecId matches the opts.codecId passed in', () => {
    const codecs = ['pg/text', 'pg/int4', 'pg/int8', 'sqlite/integer'] as const;
    for (const codecId of codecs) {
      const result = param('x', { codecId });
      expect(result.codec?.codecId).toBe(codecId);
    }
  });
});
