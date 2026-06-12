import { blindCast } from './casts';

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
  return value !== undefined
    ? blindCast<{ [P in K]: V }, 'computed key K; value is defined'>({ [key]: value })
    : {};
}

/**
 * An object with every property optional and `undefined` removed from its
 * value type — the shape produced by `definedProps`, assignable to targets
 * whose optional properties reject explicit `undefined` under
 * exactOptionalPropertyTypes.
 */
export type DefinedProps<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/**
 * Returns a copy of `obj` with all `undefined`-valued keys removed.
 * Keys whose values are `null` or any other defined value are kept.
 */
export function definedProps<T extends object>(obj: T | undefined): DefinedProps<T> {
  if (obj === undefined) return {};
  const result: Partial<Record<keyof T, unknown>> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    const value = obj[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return blindCast<DefinedProps<T>, 'all undefined values filtered above'>(result);
}
