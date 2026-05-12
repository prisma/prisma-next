/**
 * Shared abstract base for every cipherstash envelope class.
 *
 * Each concrete encrypted-column type (`EncryptedString`,
 * `EncryptedDouble`, `EncryptedBigInt`, `EncryptedDate`,
 * `EncryptedBoolean`, `EncryptedJson`) wraps a handle of the same shape
 * — only the plaintext slot's `T` differs — and shares verbatim:
 *
 *   - the `#handle` private field and its `expose()` accessor;
 *   - the `decrypt({signal?}): Promise<T>` body, including the
 *     plaintext-cache fast path, abort plumbing, and SDK round-trip;
 *   - the five `[REDACTED]` overrides
 *     (`toJSON` / `toString` / `valueOf` / `[Symbol.toPrimitive]` /
 *     `[Symbol.for('nodejs.util.inspect.custom')]`).
 *
 * Concrete subclasses provide only the typed factories
 * (`static from(plaintext: T): Self`, `static fromInternal({...}): Self`),
 * a `typeName` getter consumed by the base's error messages, and an
 * optional `parseDecryptedValue(sdkResult: unknown): T` narrowing hook
 * for codecs whose plaintext type the SDK doesn't already return as `T`
 * (e.g. `EncryptedDate` narrows to `Date`).
 *
 * ## Encapsulation pattern (Rust `secrecy` style)
 *
 * Storage is a `#private` instance field on the base. The blessed read
 * path is `expose()` — same shape as Rust `secrecy`'s
 * `SecretBox<T>::expose_secret`. The five coercion / serialization
 * vectors (logger output, `JSON.stringify`, primitive coercion,
 * template-literal interpolation, `util.inspect`) are all overridden
 * to return `[REDACTED]` so accidental exposure through any of those
 * paths is impossible without going through `expose()`.
 *
 * Modern Node runtimes surface `#private` fields in `util.inspect`
 * output by default; the `[Symbol.for('nodejs.util.inspect.custom')]`
 * override is what stops that re-exposure path.
 */

import { ifDefined } from '@prisma-next/utils/defined';
import { checkCipherstashAborted, raceCipherstashAbort } from './abort';
import type { CipherstashSdk } from './sdk';

/**
 * The mutable state shared by every envelope. The plaintext slot's `T`
 * varies per subclass; ciphertext is opaque per-cell wire bytes; the
 * `(table, column)` tuple plus `sdk` reference plumbs the per-cell SDK
 * lifecycle (single-cell `decrypt`, bulk-encrypt routing). Mutating
 * these slots from outside the package is supported but unusual; the
 * package's lifecycle mutators (`setHandleCiphertext`,
 * `setHandleRoutingKey`, `setHandlePlaintextCache`) are the conventional
 * path.
 */
export interface EncryptedEnvelopeHandle<T> {
  plaintext: T | undefined;
  ciphertext: unknown;
  table: string | undefined;
  column: string | undefined;
  sdk: CipherstashSdk | undefined;
}

export interface EncryptedEnvelopeFromInternalArgs {
  readonly ciphertext: unknown;
  readonly table: string;
  readonly column: string;
  readonly sdk: CipherstashSdk;
}

const REDACTED = '[REDACTED]';

/**
 * Placeholder shape returned by `JSON.stringify(envelope)` for every
 * concrete envelope. The marker key is derived from the subclass's
 * `typeName` (e.g. `EncryptedString` → `$encryptedString`,
 * `EncryptedDouble` → `$encryptedDouble`) so each codec carries a
 * distinct, machine-recognisable signature in serialised payloads.
 *
 * Resolves the AC-ENV4 vs AC-ENV5 tension: the four other coercion
 * paths (`toString` / `valueOf` / `[Symbol.toPrimitive]` /
 * `[Symbol.for('nodejs.util.inspect.custom')]`) keep returning the
 * literal `[REDACTED]` string for AC-ENV4; only `toJSON` returns the
 * per-type placeholder object so `JSON.stringify` renders the
 * marker shape AC-ENV5 mandates.
 */
export interface EncryptedEnvelopePlaceholder {
  readonly [marker: `$${string}`]: '<opaque>';
}

function placeholderFor(typeName: string): EncryptedEnvelopePlaceholder {
  const marker = `$${typeName.charAt(0).toLowerCase()}${typeName.slice(1)}` as const;
  // The marker key is constructed at runtime from `typeName`, so TS
  // widens the literal-form `{ [marker]: '<opaque>' }` to
  // `{ [k: string]: string }` rather than the template-literal-keyed
  // `EncryptedEnvelopePlaceholder` shape. The structural identity
  // holds at runtime — every key is `$${typeName}` per construction —
  // but the type system can't follow the dynamic key derivation, so a
  // last-resort `unknown` cast bridges the two. AGENTS.md requires
  // this rationale comment alongside any `as unknown as` cast.
  return { [marker]: '<opaque>' } as unknown as EncryptedEnvelopePlaceholder;
}

export abstract class EncryptedEnvelopeBase<T> {
  readonly #handle: EncryptedEnvelopeHandle<T>;

  protected constructor(handle: EncryptedEnvelopeHandle<T>) {
    this.#handle = handle;
  }

  /**
   * Stable, user-facing class name. Used by the base's error messages
   * so each subclass surfaces under its own identity (e.g.
   * `EncryptedString.decrypt(): ...` rather than the base class name).
   */
  protected abstract get typeName(): string;

  /**
   * Narrow the SDK's `unknown` plaintext to the subclass's `T`. The
   * default identity cast suffices for codecs whose plaintext type the
   * SDK already returns as `T` (e.g. `EncryptedString` — the SDK's
   * single-cell `decrypt` returns `Promise<string>`). Subclasses whose
   * `T` requires runtime narrowing (e.g. `EncryptedDate` constructing
   * a `Date` from an ISO string) override this hook.
   *
   * Reachable from outside the class hierarchy only via the
   * class-bounded {@link EncryptedEnvelopeBase.applyDecryptedSdkResult}
   * static method — TS lets static members access protected instance
   * members of the same class, so the friend access is scoped to
   * one well-named entry point and the hook stays `protected` against
   * arbitrary out-of-package callers.
   */
  protected parseDecryptedValue(sdkResult: unknown): T {
    return sdkResult as T;
  }

  /**
   * Apply an SDK bulk-decrypt result to an envelope: narrow the
   * polymorphic SDK return through the subclass's
   * {@link EncryptedEnvelopeBase.parseDecryptedValue} hook and cache
   * the narrowed plaintext on the handle. Returns the narrowed
   * plaintext for callers that want to observe it.
   *
   * Lives as a `static` member rather than a free function in this
   * module so it stays inside the class's lexical scope — TS's
   * class-bounded-friend convention permits a static method to call a
   * protected instance method on the same class, which is what lets
   * `parseDecryptedValue` stay `protected` while still being reachable
   * from {@link ../decrypt-all.ts decryptAll}.
   *
   * Mirrors the conventional `setHandle*` mutator shape used elsewhere
   * in this module — call sites stay symmetric across the encrypt path
   * (`setHandleCiphertext`) and the decrypt path
   * (`EncryptedEnvelopeBase.applyDecryptedSdkResult`).
   */
  static applyDecryptedSdkResult<U>(envelope: EncryptedEnvelopeBase<U>, sdkResult: unknown): U {
    const plaintext = envelope.parseDecryptedValue(sdkResult);
    envelope.expose().plaintext = plaintext;
    return plaintext;
  }

  /**
   * Explicitly retrieve the wrapped handle. Modelled on Rust `secrecy`'s
   * `SecretBox<T>::expose_secret`: the handle is reachable, but you have
   * to ask for it by name. Callers reach for `expose()` when they need
   * to inspect or transport the ciphertext envelope, debug lifecycle
   * state, or wire ad-hoc tooling around the SDK reference.
   *
   * Mutating the returned handle is supported but unusual — the
   * package's lifecycle mutators (`setHandleCiphertext`,
   * `setHandleRoutingKey`, etc.) are the conventional path during
   * encrypt / decrypt flow.
   */
  expose(): EncryptedEnvelopeHandle<T> {
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
  async decrypt(opts?: { signal?: AbortSignal }): Promise<T> {
    if (this.#handle.plaintext !== undefined) {
      return this.#handle.plaintext;
    }
    if (
      !this.#handle.sdk ||
      this.#handle.table === undefined ||
      this.#handle.column === undefined
    ) {
      throw new Error(
        `${this.typeName}.decrypt(): envelope has no cached plaintext and no SDK binding. ` +
          'This typically means the bulk-encrypt middleware did not run before the encode site.',
      );
    }
    checkCipherstashAborted(opts?.signal, 'decrypt');
    const sdkResult = await raceCipherstashAbort(
      this.#handle.sdk.decrypt({
        ciphertext: this.#handle.ciphertext,
        table: this.#handle.table,
        column: this.#handle.column,
        ...ifDefined('signal', opts?.signal),
      }),
      opts?.signal,
      'decrypt',
    );
    const plaintext = this.parseDecryptedValue(sdkResult);
    this.#handle.plaintext = plaintext;
    return plaintext;
  }

  toJSON(): EncryptedEnvelopePlaceholder {
    return placeholderFor(this.typeName);
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
 * best-effort (strings are immutable; objects can carry references the
 * caller still owns) and the GC-driven lifecycle is sufficient.
 */
export function setHandleCiphertext<T>(
  envelope: EncryptedEnvelopeBase<T>,
  ciphertext: unknown,
): void {
  envelope.expose().ciphertext = ciphertext;
}

/**
 * Populate the handle's plaintext slot with a freshly-decrypted value
 * (read-side caching path used by `decryptAll` and by `decrypt()`'s own
 * memoization).
 */
export function setHandlePlaintextCache<T>(envelope: EncryptedEnvelopeBase<T>, plaintext: T): void {
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
export function setHandleRoutingKey<T>(
  envelope: EncryptedEnvelopeBase<T>,
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
export function isHandleDecrypted<T>(envelope: EncryptedEnvelopeBase<T>): boolean {
  return envelope.expose().plaintext !== undefined;
}
