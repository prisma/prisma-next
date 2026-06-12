/**
 * Returns an object with the key/value if value is defined, otherwise an empty object.
 *
 * Use with spread to conditionally include optional properties while satisfying
 * exactOptionalPropertyTypes. This is explicit about which properties are optional
 * and won't inadvertently strip other undefined values.
 *
 * @example
 * ```typescript
 * // Instead of:
 * const obj = {
 *   required: 'value',
 *   ...(optional ? { optional } : {}),
 * };
 *
 * // Use:
 * const obj = {
 *   required: 'value',
 *   ...ifDefined('optional', optional),
 * };
 * ```
 */
export function ifDefined<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<never, never> | { [P in K]: V } {
  return value !== undefined ? ({ [key]: value } as { [P in K]: V }) : {};
}

/**
 * Returns a copy of `obj` with all `undefined`-valued keys removed.
 * Keys whose values are `null` or any other defined value are kept.
 */
export function definedProps<T extends object>(obj: T | undefined): Partial<T> {
  if (obj === undefined) return {};
  const result: Partial<T> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}
