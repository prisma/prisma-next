/**
 * `EncryptedString` envelope and its package-internal handle helpers.
 *
 * The envelope is the user-facing input/output type for cipherstash-
 * backed columns. The handle is package-private — its TypeScript shape
 * is not exported and no public method on `EncryptedString` returns it
 * (AC-ENV4). Storage is a module-scoped `WeakMap` keyed on the envelope
 * so `Object.keys(envelope)` and the default `JSON.stringify` shape stay
 * trivially clean across every JS host.
 *
 * The handle has two flavours:
 *   - **Write side** — `EncryptedString.from(plaintext)` populates the
 *     `plaintext` slot and leaves `ciphertext` empty. The bulk-encrypt
 *     middleware (M2 R2) populates `ciphertext`. Per `plan.md § Open
 *     items 6` (resolved 2026-05-06), the middleware does **not** zero
 *     the plaintext slot post-encrypt; as a side effect a write-side
 *     envelope's `decrypt()` returns the original plaintext synchronously
 *     without an SDK round-trip.
 *   - **Read side** — `EncryptedString.fromInternal({...})` (called from
 *     the codec `decode` body) populates `ciphertext`, `(table, column)`
 *     from `SqlCodecCallContext.column`, and an `sdk` reference so
 *     `decrypt({signal?})` can issue the SDK's single-cell decrypt.
 */

import { ifDefined } from '@prisma-next/utils/defined';
import type { CipherstashSdk } from './sdk';

interface EncryptedStringHandle {
  plaintext: string | undefined;
  ciphertext: unknown;
  table: string | undefined;
  column: string | undefined;
  sdk: CipherstashSdk | undefined;
}

const handles = new WeakMap<EncryptedString, EncryptedStringHandle>();

/**
 * Internal accessor used by the codec, the bulk-encrypt middleware, and
 * `decryptAll`. Not exported from any subpath; package-internal call
 * sites import this from the module directly.
 */
export function getInternalHandle(envelope: EncryptedString): EncryptedStringHandle {
  const handle = handles.get(envelope);
  if (!handle) {
    throw new Error(
      'EncryptedString: handle missing — envelope was not constructed via the official factories.',
    );
  }
  return handle;
}

/**
 * Populate the handle's ciphertext slot. Called by the bulk-encrypt
 * middleware after the SDK returns the encrypted batch (M2 R2).
 *
 * Per `plan.md § Open items 6` (resolved 2026-05-06), the plaintext slot
 * is intentionally retained — zeroing in JS is best-effort (strings are
 * immutable) and the GC-driven lifecycle is sufficient for Project 1's
 * bounded scope.
 */
export function setHandleCiphertext(envelope: EncryptedString, ciphertext: unknown): void {
  getInternalHandle(envelope).ciphertext = ciphertext;
}

/**
 * Populate the handle's plaintext slot with a freshly-decrypted value
 * (read-side caching path used by `decryptAll` and by `decrypt()`'s own
 * memoization).
 */
export function setHandlePlaintextCache(envelope: EncryptedString, plaintext: string): void {
  getInternalHandle(envelope).plaintext = plaintext;
}

/**
 * `true` when the handle already carries a usable plaintext (write-side
 * construction or post-`decrypt` caching). Used by `decryptAll` to skip
 * envelopes that don't need a round-trip.
 */
export function isHandleDecrypted(envelope: EncryptedString): boolean {
  return getInternalHandle(envelope).plaintext !== undefined;
}

export interface EncryptedStringFromInternalArgs {
  readonly ciphertext: unknown;
  readonly table: string;
  readonly column: string;
  readonly sdk: CipherstashSdk;
}

export class EncryptedString {
  /**
   * Construct a write-side envelope from plaintext. Bulk-encrypt
   * middleware (M2 R2) populates the handle's ciphertext slot before the
   * codec encodes the envelope to wire format.
   */
  static from(plaintext: string): EncryptedString {
    const envelope = new EncryptedString();
    handles.set(envelope, {
      plaintext,
      ciphertext: undefined,
      table: undefined,
      column: undefined,
      sdk: undefined,
    });
    return envelope;
  }

  /**
   * Construct a read-side envelope from a wire ciphertext + the column
   * identity + the SDK used to decrypt the cell. Called from the codec
   * `decode` body; intentionally exported from `core/envelope.ts` for
   * the codec and for tests, but not re-exported from any subpath.
   */
  static fromInternal(args: EncryptedStringFromInternalArgs): EncryptedString {
    const envelope = new EncryptedString();
    handles.set(envelope, {
      plaintext: undefined,
      ciphertext: args.ciphertext,
      table: args.table,
      column: args.column,
      sdk: args.sdk,
    });
    return envelope;
  }

  /**
   * Decrypt and return the plaintext.
   *
   * - If the handle's `plaintext` slot is already populated (write-side
   *   envelopes from `from(plaintext)`, or read-side envelopes
   *   already materialized by `decryptAll(...)` or a prior `decrypt()`),
   *   returns the cached plaintext synchronously without consulting the
   *   SDK.
   * - Otherwise (read-side handle without a cached plaintext), invokes
   *   the SDK's single-cell `decrypt` with the handle's routing context.
   *   The caller-supplied `signal` is forwarded to the SDK by identity
   *   per the umbrella cancellation contract.
   */
  async decrypt(opts?: { signal?: AbortSignal }): Promise<string> {
    const handle = getInternalHandle(this);
    if (handle.plaintext !== undefined) {
      return handle.plaintext;
    }
    if (!handle.sdk || handle.table === undefined || handle.column === undefined) {
      throw new Error(
        'EncryptedString.decrypt(): envelope has no cached plaintext and no SDK binding. ' +
          'This typically means the bulk-encrypt middleware did not run before the encode site.',
      );
    }
    const plaintext = await handle.sdk.decrypt({
      ciphertext: handle.ciphertext,
      table: handle.table,
      column: handle.column,
      ...ifDefined('signal', opts?.signal),
    });
    handle.plaintext = plaintext;
    return plaintext;
  }

  /**
   * `JSON.stringify(envelope)` produces a non-revealing placeholder
   * regardless of which slot of the handle is populated. Without this
   * override `JSON.stringify` would still produce `{}` (handle data
   * lives in a `WeakMap`), but the explicit placeholder documents the
   * intent and matches the umbrella spec's open-question default.
   */
  toJSON(): unknown {
    return { $encryptedString: '<opaque>' };
  }
}
