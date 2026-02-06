import { expect } from 'vitest';

export function expectDefined<T>(value: T | undefined): asserts value is T {
  expect(value).toBeDefined();
}

/**
 * Asserts the truthiness of the given value, narrowing its type.
 * Use in tests as a type-narrowing alternative to bare `expect`.
 *
 * @example
 * ```typescript
 * const result = planner.plan(...);
 * expectType(result.kind === 'success', 'expected planner success');
 * // result is now narrowed to the success branch
 * ```
 */
export function expectType(value: unknown, message?: string): asserts value {
  expect(value, message).toBeTruthy();
}
