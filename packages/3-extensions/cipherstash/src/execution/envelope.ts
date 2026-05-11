/**
 * `EncryptedString` envelope and its package-internal handle helpers.
 *
 * The envelope is the user-facing input/output type for cipherstash-
 * backed columns. It wraps an `EncryptedStringHandle` (plaintext slot,
 * ciphertext slot, routing key, SDK reference) holding the per-cell
 * lifecycle state.
 *
 * ## Encapsulation pattern (Rust `secrecy` style)
 *
 * Storage is a `#private` instance field. The blessed read path is the
 * explicit `expose()` method — same shape as the Rust `secrecy` crate's
 * `SecretBox<T>::expose_secret`. Calling `expose()` is a deliberate
 * opt-in: the caller is announcing "I want the wrapped state". The
 * envelope does not — and is not meant to — make that *impossible*; it
 * is meant to make accidental exposure (logger output, error envelopes,
 * stringification, JSON serialization, primitive coercion) impossible
 * unless the caller goes through `expose()`.
 *
 * Concretely the class overrides every coercion / serialization vector
 * that would otherwise reveal the handle:
 *
 *   - `toJSON()`                                    — `JSON.stringify`
 *   - `toString()`                                  — `String(envelope)`
 *   - `valueOf()`                                   — legacy primitive coercion
 *   - `[Symbol.toPrimitive]()`                      — template literals, `+`
 *   - `[Symbol.for('nodejs.util.inspect.custom')]()` — `console.log`,
 *                                                     Node REPL, debuggers
 *
 * All five return the same `[REDACTED]` placeholder. Without these
 * overrides, modern Node runtimes surface `#private` fields in
 * `util.inspect` output by default, which would silently re-expose
 * the handle through `console.log(envelope)` (and any error message
 * that interpolates an envelope).
 *
 * ## Lifecycle
 *
 * The handle has two flavours:
 *   - **Write side** — `EncryptedString.from(plaintext)` populates the
 *     `plaintext` slot and leaves `ciphertext` empty. The bulk-encrypt
 *     middleware populates `ciphertext` post-SDK and intentionally
 *     leaves the plaintext slot in place (zeroing JS strings is
 *     best-effort and GC-driven lifecycle is sufficient here). As a
 *     side effect a write-side envelope's `decrypt()` returns the
 *     original plaintext synchronously without an SDK round-trip.
 *   - **Read side** — `EncryptedString.fromInternal({...})` (called from
 *     the codec `decode` body) populates `ciphertext`, `(table, column)`
 *     from `SqlCodecCallContext.column`, and an `sdk` reference so
 *     `decrypt({signal?})` can issue the SDK's single-cell decrypt.
 */

import { ifDefined } from '@prisma-next/utils/defined';
import { checkCipherstashAborted, raceCipherstashAbort } from './abort';
import type { CipherstashSdk } from './sdk';

/**
 * The mutable state of an `EncryptedString` — exposed by `expose()` for
 * callers that explicitly opt in. Mutating these slots from outside the
 * package is supported (we don't stop you) but unusual; the framework's
 * own lifecycle mutators (`setHandleCiphertext`, `setHandleRoutingKey`,
 * etc.) are the conventional path.
 */
export interface EncryptedStringHandle {
  plaintext: string | undefined;
  ciphertext: unknown;
  table: string | undefined;
  column: string | undefined;
  sdk: CipherstashSdk | undefined;
}

const REDACTED = '[REDACTED]';

export interface EncryptedStringFromInternalArgs {
  readonly ciphertext: unknown;
  readonly table: string;
  readonly column: string;
  readonly sdk: CipherstashSdk;
}

export class EncryptedString {
  readonly #handle: EncryptedStringHandle;

  private constructor(handle: EncryptedStringHandle) {
    this.#handle = handle;
  }

  /**
   * Construct a write-side envelope from plaintext. Bulk-encrypt
   * middleware populates the handle's ciphertext slot before the codec
   * encodes the envelope to wire format.
   */
  static from(plaintext: string): EncryptedString {
    return new EncryptedString({
      plaintext,
      ciphertext: undefined,
      table: undefined,
      column: undefined,
      sdk: undefined,
    });
  }

  /**
   * Construct a read-side envelope from a wire ciphertext + the column
   * identity + the SDK used to decrypt the cell. Called from the codec
   * `decode` body.
   */
  static fromInternal(args: EncryptedStringFromInternalArgs): EncryptedString {
    return new EncryptedString({
      plaintext: undefined,
      ciphertext: args.ciphertext,
      table: args.table,
      column: args.column,
      sdk: args.sdk,
    });
  }

  /**
   * Explicitly retrieve the wrapped handle. Modelled on Rust `secrecy`'s
   * `SecretBox<T>::expose_secret`: the handle is reachable, but you have
   * to ask for it by name. Callers reach for `expose()` when they need
   * to inspect or transport the ciphertext envelope, debug lifecycle
   * state, or wire ad-hoc tooling around the SDK reference.
   *
   * Mutating the returned handle is supported but unusual — the
   * framework's lifecycle mutators (`setHandleCiphertext`,
   * `setHandleRoutingKey`, etc.) are the conventional path during
   * encrypt / decrypt flow.
   */
  expose(): EncryptedStringHandle {
    return this.#handle;
  }

  /**
   * Decrypt and return the plaintext.
   *
   * - If the handle's `plaintext` slot is already populated (write-side
   *   envelopes from `from(plaintext)`, or read-side envelopes already
   *   materialized by `decryptAll(...)` or a prior `decrypt()`), returns
   *   the cached plaintext synchronously without consulting the SDK.
   * - Otherwise (read-side handle without a cached plaintext), invokes
   *   the SDK's single-cell `decrypt` with the handle's routing context.
   *   The caller-supplied `signal` is forwarded to the SDK by identity
   *   per the umbrella cancellation contract; the SDK promise is also
   *   raced against the signal so an abort surfaces a `RUNTIME.ABORTED
   *   { phase: 'decrypt' }` envelope promptly even if the SDK body
   *   ignores the signal. The cached-plaintext fast path returns
   *   synchronously without consulting the signal — no IO, no abort
   *   observation point.
   */
  async decrypt(opts?: { signal?: AbortSignal }): Promise<string> {
    if (this.#handle.plaintext !== undefined) {
      return this.#handle.plaintext;
    }
    if (
      !this.#handle.sdk ||
      this.#handle.table === undefined ||
      this.#handle.column === undefined
    ) {
      throw new Error(
        'EncryptedString.decrypt(): envelope has no cached plaintext and no SDK binding. ' +
          'This typically means the bulk-encrypt middleware did not run before the encode site.',
      );
    }
    checkCipherstashAborted(opts?.signal, 'decrypt');
    const plaintext = await raceCipherstashAbort(
      this.#handle.sdk.decrypt({
        ciphertext: this.#handle.ciphertext,
        table: this.#handle.table,
        column: this.#handle.column,
        ...ifDefined('signal', opts?.signal),
      }),
      opts?.signal,
      'decrypt',
    );
    this.#handle.plaintext = plaintext;
    return plaintext;
  }

  toJSON(): string {
    return REDACTED;
  }

  toString(): string {
    return REDACTED;
  }

  valueOf(): string {
    return REDACTED;
  }

  [Symbol.toPrimitive](): string {
    return REDACTED;
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return REDACTED;
  }
}

/**
 * Populate the handle's ciphertext slot. Called by the bulk-encrypt
 * middleware after the SDK returns the encrypted batch.
 *
 * The plaintext slot is intentionally retained — zeroing in JS is
 * best-effort (strings are immutable) and the GC-driven lifecycle is
 * sufficient.
 */
export function setHandleCiphertext(envelope: EncryptedString, ciphertext: unknown): void {
  envelope.expose().ciphertext = ciphertext;
}

/**
 * Populate the handle's plaintext slot with a freshly-decrypted value
 * (read-side caching path used by `decryptAll` and by `decrypt()`'s own
 * memoization).
 */
export function setHandlePlaintextCache(envelope: EncryptedString, plaintext: string): void {
  envelope.expose().plaintext = plaintext;
}

/**
 * Stamp the encrypt-side `(table, column)` routing context onto a
 * write-side envelope's handle. Called by the bulk-encrypt middleware
 * before grouping envelopes into per-routing-key bulk-encrypt batches.
 *
 * Idempotent for matching reassignments (re-stamping the same
 * `(table, column)` is a no-op, which covers envelopes reconstructed
 * via `fromInternal` on the read side and re-stamped on the way back
 * in). Conflicting reassignments throw a descriptive error: an
 * envelope reused across plans with a different routing context is a
 * programming error — silently keeping the stale binding would lower
 * to the wrong bulk-encrypt batch.
 */
export function setHandleRoutingKey(
  envelope: EncryptedString,
  table: string,
  column: string,
): void {
  const handle = envelope.expose();
  if (handle.table === undefined) {
    handle.table = table;
  } else if (handle.table !== table) {
    throw new Error(
      `cipherstash envelope: routing-key table conflict — handle already bound to "${handle.table}", refusing to rebind to "${table}". Re-encode the value or construct a fresh envelope for the new routing target.`,
    );
  }
  if (handle.column === undefined) {
    handle.column = column;
  } else if (handle.column !== column) {
    throw new Error(
      `cipherstash envelope: routing-key column conflict on table "${handle.table}" — handle already bound to "${handle.column}", refusing to rebind to "${column}". Re-encode the value or construct a fresh envelope for the new routing target.`,
    );
  }
}

/**
 * `true` when the handle already carries a usable plaintext (write-side
 * construction or post-`decrypt` caching). Used by `decryptAll` to skip
 * envelopes that don't need a round-trip.
 */
export function isHandleDecrypted(envelope: EncryptedString): boolean {
  return envelope.expose().plaintext !== undefined;
}
