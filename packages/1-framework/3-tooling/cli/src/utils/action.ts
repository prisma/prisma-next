import type { Result } from '@prisma-next/utils/result';
import { notOk, ok } from '@prisma-next/utils/result';
import { CliStructuredError } from './cli-errors';

export type CliResult<T> = Result<T, CliStructuredError>;

/**
 * Performs an async action and catches structured errors, returning a Result.
 * Only catches CliStructuredError instances - other errors are allowed to propagate (fail fast).
 * If the function throws a CliStructuredError, it's caught and converted to a NotOk result.
 */
export async function performAction<T>(fn: () => Promise<T>): Promise<CliResult<T>> {
  try {
    const value = await fn();
    return ok(value);
  } catch (error) {
    // Only catch structured errors - let other errors propagate (fail fast)
    if (error instanceof CliStructuredError) {
      return notOk(error);
    }
    // Re-throw non-structured errors to fail fast
    throw error;
  }
}

/**
 * Wraps a synchronous function to catch structured errors and return a Result.
 * Only catches CliStructuredError instances - other errors are allowed to propagate (fail fast).
 * If the function throws a CliStructuredError, it's caught and converted to a NotOk result.
 */
export function wrapSync<T>(fn: () => T): CliResult<T> {
  try {
    const value = fn();
    return ok(value);
  } catch (error) {
    // Only catch structured errors - let other errors propagate (fail fast)
    if (error instanceof CliStructuredError) {
      return notOk(error);
    }
    // Re-throw non-structured errors to fail fast
    throw error;
  }
}
