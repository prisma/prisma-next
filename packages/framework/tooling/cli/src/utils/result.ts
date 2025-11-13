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

import { CliStructuredError } from './cli-errors';

/**
 * Performs an async action and catches structured errors, returning a Result.
 * Only catches CliStructuredError instances - other errors are allowed to propagate (fail fast).
 * If the function throws a CliStructuredError, it's caught and converted to an Err result.
 */
export async function performAction<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const value = await fn();
    return ok(value);
  } catch (error) {
    // Only catch structured errors - let other errors propagate (fail fast)
    if (error instanceof CliStructuredError) {
      return err(error);
    }
    // Re-throw non-structured errors to fail fast
    throw error;
  }
}

/**
 * Wraps a synchronous function to catch structured errors and return a Result.
 * Only catches CliStructuredError instances - other errors are allowed to propagate (fail fast).
 * If the function throws a CliStructuredError, it's caught and converted to an Err result.
 */
export function wrapSync<T>(fn: () => T): Result<T> {
  try {
    const value = fn();
    return ok(value);
  } catch (error) {
    // Only catch structured errors - let other errors propagate (fail fast)
    if (error instanceof CliStructuredError) {
      return err(error);
    }
    // Re-throw non-structured errors to fail fast
    throw error;
  }
}
