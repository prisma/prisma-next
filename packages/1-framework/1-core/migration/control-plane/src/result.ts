/**
 * Generic Result type for representing success or failure outcomes.
 *
 * This is the standard way to return "expected failures" as values rather than
 * throwing exceptions. See docs/Error Handling.md for the full taxonomy.
 *
 * Naming rationale:
 * - `Ok<T>` / `NotOk<F>` mirror the `ok: true/false` discriminator
 * - `NotOk` avoids collision with domain types like "Failure" or "Error"
 * - `failure` property distinguishes from JS Error semantics
 */

/**
 * Represents a successful result containing a value.
 */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/**
 * Represents an unsuccessful result containing failure details.
 */
export interface NotOk<F> {
  readonly ok: false;
  readonly failure: F;
}

/**
 * A discriminated union representing either success (Ok) or failure (NotOk).
 *
 * @typeParam T - The success value type
 * @typeParam F - The failure details type (defaults to unknown)
 */
export type Result<T, F = unknown> = Ok<T> | NotOk<F>;

/**
 * Creates a successful result.
 */
export function ok<T>(value: T): Ok<T> {
  return Object.freeze({ ok: true, value });
}

/**
 * Creates an unsuccessful result.
 */
export function notOk<F>(failure: F): NotOk<F> {
  return Object.freeze({ ok: false, failure });
}

/**
 * Singleton for void success results.
 * Use this for validation checks that don't produce a value.
 */
const OK_VOID: Ok<void> = Object.freeze({ ok: true, value: undefined });

/**
 * Returns a successful void result.
 * Use this for validation checks that don't produce a value.
 */
export function okVoid(): Ok<void> {
  return OK_VOID;
}
