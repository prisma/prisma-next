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
 *   ...defined('optional', optional),
 * };
 * ```
 */
export function defined<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<never, never> | { [P in K]: V } {
  return value !== undefined ? ({ [key]: value } as { [P in K]: V }) : {};
}
