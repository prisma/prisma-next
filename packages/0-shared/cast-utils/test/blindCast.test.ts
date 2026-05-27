import { describe, expect, expectTypeOf, it } from 'vitest';
import { blindCast } from '../src/blindCast';

describe('blindCast', () => {
  it('returns the input unchanged at runtime', () => {
    const input: unknown = { a: 1 };
    const result = blindCast<{ a: number }, 'unit test'>(input);
    expect(result).toBe(input);
  });

  it('returns primitive inputs unchanged', () => {
    expect(blindCast<string, 'unit test'>('hello')).toBe('hello');
    expect(blindCast<number, 'unit test'>(42)).toBe(42);
    expect(blindCast<boolean, 'unit test'>(true)).toBe(true);
  });

  it('returns null and undefined unchanged', () => {
    expect(blindCast<null, 'unit test'>(null)).toBeNull();
    expect(blindCast<undefined, 'unit test'>(undefined)).toBeUndefined();
  });

  it('preserves object identity (does not clone or freeze)', () => {
    const input = { nested: { value: 1 } };
    const result = blindCast<{ nested: { value: number } }, 'unit test'>(input);
    expect(result).toBe(input);
    expect(result.nested).toBe(input.nested);
    expect(Object.isFrozen(result)).toBe(false);
  });

  it('produces a value of the requested target type', () => {
    const result = blindCast<{ a: number }, 'unit test'>({ a: 1 } as unknown);
    expectTypeOf(result).toEqualTypeOf<{ a: number }>();
  });

  it('requires a string-literal Reason at the call site', () => {
    const result = blindCast<string, 'demonstrating the reason literal'>('value');
    expect(result).toBe('value');
  });
});
