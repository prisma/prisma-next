import { expect } from 'vitest';

export function expectDefined<T>(value: T | undefined): asserts value is T {
  expect(value).toBeDefined();
}
