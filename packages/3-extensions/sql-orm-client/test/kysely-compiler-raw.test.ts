import { describe, expect, it } from 'vitest';
import {
  quoteIdentifier,
  shiftParameterPlaceholders,
  toRawCompiledQuery,
} from '../src/kysely-compiler-raw';

describe('kysely-compiler-raw', () => {
  it('shiftParameterPlaceholders() leaves sql unchanged with zero offset', () => {
    expect(shiftParameterPlaceholders('select $1, $2', 0)).toBe('select $1, $2');
  });

  it('shiftParameterPlaceholders() increments positional placeholders', () => {
    expect(shiftParameterPlaceholders('select $1, $12', 3)).toBe('select $4, $15');
  });

  it('quoteIdentifier() escapes embedded quotes', () => {
    expect(quoteIdentifier('user"name')).toBe('"user""name"');
  });

  it('toRawCompiledQuery() creates a compiled query with copied parameters', () => {
    const params = [1, 'x'];
    const compiled = toRawCompiledQuery<{ id: number }>('select $1, $2', params);
    params.push('mutated');

    expect(compiled.sql).toBe('select $1, $2');
    expect(compiled.parameters).toEqual([1, 'x']);
  });
});
