/**
 * Result type for CLI command outcomes.
 * Represents either success (Ok) or failure (Err).
 */
export type Result<T> = Ok<T> | Err;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err {
  readonly ok: false;
  readonly error: Error;
}

/**
 * Creates a successful result.
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/**
 * Creates an error result.
 */
export function err(error: Error): Err {
  return { ok: false, error };
}

/**
 * Wraps an async function to catch errors and return a Result.
 * If the function throws, it's caught and converted to an Err result.
 */
export async function wrapAsync<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const value = await fn();
    return ok(value);
  } catch (error) {
    if (error instanceof Error) {
      return err(error);
    }
    return err(new Error(String(error)));
  }
}

/**
 * Wraps a synchronous function to catch errors and return a Result.
 * If the function throws, it's caught and converted to an Err result.
 */
export function wrapSync<T>(fn: () => T): Result<T> {
  try {
    const value = fn();
    return ok(value);
  } catch (error) {
    if (error instanceof Error) {
      return err(error);
    }
    return err(new Error(String(error)));
  }
}
