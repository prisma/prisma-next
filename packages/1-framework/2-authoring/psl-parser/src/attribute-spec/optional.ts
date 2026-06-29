import type { ArgType, OptionalParam } from './types';

/**
 * Marks a parameter optional. With a second argument, the value is applied as a
 * default when the argument is absent; without one, an absent argument leaves
 * the output property unset.
 */
export function optional<T>(type: ArgType<T>, ...rest: [defaultValue: T] | []): OptionalParam<T> {
  if (rest.length === 0) {
    return { optional: true, type, hasDefault: false };
  }
  return { optional: true, type, hasDefault: true, defaultValue: rest[0] };
}
