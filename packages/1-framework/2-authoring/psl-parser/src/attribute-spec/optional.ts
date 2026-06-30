import type { ArgType, OptionalArgType } from './types';

/**
 * Marks a parameter optional, returning a flavoured `ArgType` that parses like
 * the wrapped type. With a second argument, the value is applied as a default
 * when the argument is absent; without one, an absent argument leaves the output
 * property unset.
 */
export function optional<T>(type: ArgType<T>, ...rest: [defaultValue: T] | []): OptionalArgType<T> {
  if (rest.length === 0) {
    return { ...type, optional: true, hasDefault: false };
  }
  return { ...type, optional: true, hasDefault: true, defaultValue: rest[0] };
}
