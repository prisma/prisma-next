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
  assertOk(): T;
  assertNotOk(): never;
}

/**
 * Represents an unsuccessful result containing failure details.
 */
export interface NotOk<F> {
  readonly ok: false;
  readonly failure: F;
  assertOk(): never;
  assertNotOk(): F;
}

/**
 * A discriminated union representing either success (Ok) or failure (NotOk).
 *
 * @typeParam T - The success value type
 * @typeParam F - The failure details type
 */
export type Result<T, F> = Ok<T> | NotOk<F>;

/**
 * Result class that implements both Ok and NotOk variants.
 */
class ResultImpl<T, F> {
  readonly ok: boolean;
  readonly value!: T;
  readonly failure!: F;

  private constructor(ok: boolean, valueOrFailure: T | F) {
    this.ok = ok;
    if (ok) {
      this.value = valueOrFailure as T;
      this.assertOk = function (this: Ok<T>): T {
        return this.value;
      };
      this.assertNotOk = function (this: Ok<T>): never {
        throw new Error('Expected NotOk result but got Ok');
      };
    } else {
      this.failure = valueOrFailure as F;
      this.assertOk = function (this: NotOk<F>): never {
        throw new Error('Expected Ok result but got NotOk');
      };
      this.assertNotOk = function (this: NotOk<F>): F {
        return this.failure;
      };
    }
    Object.freeze(this);
  }

  /**
   * Creates a successful result.
   */
  static ok<T, F = never>(value: T): Ok<T> {
    return new ResultImpl<T, F>(true, value) as unknown as Ok<T>;
  }

  /**
   * Creates an unsuccessful result.
   */
  static notOk<T = never, F = unknown>(failure: F): NotOk<F> {
    return new ResultImpl<T, F>(false, failure) as unknown as NotOk<F>;
  }

  /**
   * Asserts that this result is Ok and returns the value.
   * Throws if the result is NotOk.
   */
  assertOk(this: Result<T, F>): T {
    if (!this.ok) {
      throw new Error('Expected Ok result but got NotOk');
    }
    return this.value;
  }

  /**
   * Asserts that this result is NotOk and returns the failure.
   * Throws if the result is Ok.
   */
  assertNotOk(this: Result<T, F>): F {
    if (this.ok) {
      throw new Error('Expected NotOk result but got Ok');
    }
    return this.failure;
  }
}

/**
 * Creates a successful result.
 */
export function ok<T>(value: T): Ok<T> {
  return ResultImpl.ok(value);
}

/**
 * Creates an unsuccessful result.
 */
export function notOk<F>(failure: F): NotOk<F> {
  return ResultImpl.notOk(failure);
}

/**
 * Singleton for void success results.
 * Use this for validation checks that don't produce a value.
 */
const OK_VOID: Ok<void> = ResultImpl.ok<void>(undefined);

/**
 * Returns a successful void result.
 * Use this for validation checks that don't produce a value.
 */
export function okVoid(): Ok<void> {
  return OK_VOID;
}
