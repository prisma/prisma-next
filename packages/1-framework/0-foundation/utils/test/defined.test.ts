import { describe, expect, it } from 'vitest';
import { definedProps, ifDefined } from '../src/defined';

describe('ifDefined', () => {
  it('returns object with key/value when value is defined', () => {
    const result = ifDefined('name', 'Alice');
    expect(result).toEqual({ name: 'Alice' });
  });

  it('returns empty object when value is undefined', () => {
    const result = ifDefined('name', undefined);
    expect(result).toEqual({});
  });

  it('preserves falsy values that are not undefined', () => {
    expect(ifDefined('value', 0)).toEqual({ value: 0 });
    expect(ifDefined('value', '')).toEqual({ value: '' });
    expect(ifDefined('value', false)).toEqual({ value: false });
    expect(ifDefined('value', null)).toEqual({ value: null });
  });

  it('works with spread operator', () => {
    const optional: string | undefined = 'test';
    const result = {
      required: 'value',
      ...ifDefined('optional', optional),
    };
    expect(result).toEqual({ required: 'value', optional: 'test' });
  });

  it('does not add key when spread with undefined', () => {
    const optional: string | undefined = undefined;
    const result = {
      required: 'value',
      ...ifDefined('optional', optional),
    };
    expect(result).toEqual({ required: 'value' });
    expect('optional' in result).toBe(false);
  });

  it('works with complex objects', () => {
    const context = { path: '/test', config: { debug: true } };
    const result = ifDefined('context', context);
    expect(result).toEqual({ context: { path: '/test', config: { debug: true } } });
  });
});

describe('definedProps', () => {
  it('returns empty object for undefined input', () => {
    expect(definedProps(undefined)).toEqual({});
  });

  it('removes undefined-valued keys', () => {
    const result = definedProps({ a: 1, b: undefined, c: 'x' });
    expect(result).toEqual({ a: 1, c: 'x' });
    expect('b' in result).toBe(false);
  });

  it('preserves null and other falsy values', () => {
    const result = definedProps({ a: null, b: 0, c: false, d: '' });
    expect(result).toEqual({ a: null, b: 0, c: false, d: '' });
  });

  it('returns a new object (no mutation)', () => {
    const input = { a: 1, b: 2 };
    const result = definedProps(input);
    expect(result).not.toBe(input);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('returns empty object when all values are undefined', () => {
    expect(definedProps({ a: undefined, b: undefined })).toEqual({});
  });
});
