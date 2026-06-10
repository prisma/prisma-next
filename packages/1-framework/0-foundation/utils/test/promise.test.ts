import { describe, expect, it } from 'vitest';
import { isThenable } from '../src/promise';

describe('isThenable', () => {
  it('returns true for a native Promise', () => {
    expect(isThenable(Promise.resolve(1))).toBe(true);
  });

  it('returns true for a custom thenable', () => {
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable fixture for isThenable tests
    const thenable = { then: () => {} };
    expect(isThenable(thenable)).toBe(true);
  });

  it('returns false for a plain value', () => {
    expect(isThenable(42)).toBe(false);
    expect(isThenable('hello')).toBe(false);
    expect(isThenable(null)).toBe(false);
    expect(isThenable(undefined)).toBe(false);
    expect(isThenable({})).toBe(false);
  });

  it('returns false when then is not a function', () => {
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable fixture for isThenable tests
    const notAThenable = { then: 'not a function' };
    expect(isThenable(notAThenable)).toBe(false);
  });
});
