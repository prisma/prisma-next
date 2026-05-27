import { describe, expect, expectTypeOf, it } from 'vitest';
import { castAs } from '../src/castAs';

describe('castAs', () => {
  it('returns the value unchanged at runtime', () => {
    const input = { a: 1 };
    const result = castAs<{ a: number }>(input);
    expect(result).toBe(input);
  });

  it('returns primitive inputs unchanged', () => {
    expect(castAs<string>('hello')).toBe('hello');
    expect(castAs<number>(42)).toBe(42);
    expect(castAs<boolean>(true)).toBe(true);
  });

  it('preserves object identity (does not clone or freeze)', () => {
    const input = { nested: { value: 1 } };
    const result = castAs<{ nested: { value: number } }>(input);
    expect(result).toBe(input);
    expect(result.nested).toBe(input.nested);
    expect(Object.isFrozen(result)).toBe(false);
  });

  it('narrows the result type to the requested type parameter', () => {
    const wide: string | number = 'hello' as string | number;
    const result = castAs<string | number>(wide);
    expectTypeOf(result).toEqualTypeOf<string | number>();
  });

  it('requires the value to be assignable to the target type', () => {
    const obj: { key: string; subKey: number } = { key: 'value', subKey: 2 };
    const result = castAs<{ key: string; subKey: number }>(obj);
    expectTypeOf(result).toEqualTypeOf<{ key: string; subKey: number }>();
    expect(result).toEqual({ key: 'value', subKey: 2 });
  });
});
