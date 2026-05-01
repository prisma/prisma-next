import type { CipherstashSdk } from './sdk';

/**
 * Package-internal mutable state for an `EncryptedString`. Lives in a
 * module-private `WeakMap` keyed on the envelope; never surfaced to
 * package consumers (no `EncryptedStringHandle` is exported, no
 * accessor on the envelope returns the handle).
 *
 * - **Write side** — `EncryptedString.from(plaintext)` produces a handle
 *   with `plaintext` populated and `ciphertext` empty. The bulk-encrypt
 *   middleware (M2.c) populates `ciphertext` and overwrites `plaintext`
 *   with `undefined` for memory hygiene before `codec.encode` runs.
 * - **Read side** — `EncryptedString.fromInternal({...})` (called from
 *   `codec.decode`) produces a handle with `ciphertext` populated and
 *   `{table, column, sdk}` carrying the routing context for
 *   `decrypt({signal?})` and `bulkDecrypt(...)` (M4).
 */
interface EncryptedStringHandle {
  plaintext: string | undefined;
  ciphertext: unknown;
  table: string | undefined;
  column: string | undefined;
  sdk: CipherstashSdk | undefined;
}

const handles = new WeakMap<EncryptedString, EncryptedStringHandle>();

/**
 * Internal accessors used by the codec, the bulk-encrypt middleware,
 * and `decryptAll`. Not exported from any subpath; package-internal
 * call sites import these from this module directly.
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

export function setHandleCiphertext(envelope: EncryptedString, ciphertext: unknown): void {
  const handle = getInternalHandle(envelope);
  handle.ciphertext = ciphertext;
  handle.plaintext = undefined;
}

export function setHandlePlaintextCache(envelope: EncryptedString, plaintext: string): void {
  const handle = getInternalHandle(envelope);
  handle.plaintext = plaintext;
}

export function isHandleDecrypted(envelope: EncryptedString): boolean {
  return getInternalHandle(envelope).plaintext !== undefined;
}

export interface EncryptedStringFromInternalArgs {
  readonly ciphertext: unknown;
  readonly table: string;
  readonly column: string;
  readonly sdk: CipherstashSdk;
}

/**
 * Envelope wrapping a CipherStash-encrypted string value.
 *
 * The class owns its handle internally; the handle is never returned
 * from any public method and no public accessor exposes its slots
 * (AC-ENV4). The handle's storage choice — a module-scoped `WeakMap` —
 * is an implementation detail; the same security/isolation guarantees
 * apply with `#`-prefixed fields, but `WeakMap` keeps the runtime
 * surface (`Object.keys`, `JSON.stringify`) trivially clean across
 * every JS host without extra `toJSON`/`Symbol.toPrimitive` work.
 */
export class EncryptedString {
  /**
   * Construct from plaintext. The bulk-encrypt middleware (M2.c)
   * populates the handle's ciphertext slot and overwrites the
   * plaintext slot before the codec encodes the envelope to wire.
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
   * identity + the SDK used to decrypt the cell. Called from
   * `codec.decode`; not part of the public user-facing API but
   * intentionally exported from `core/envelope.ts` for the codec and
   * for tests.
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
   *   envelopes constructed via `from(plaintext)`, or read-side
   *   envelopes already materialized by `decryptAll(...)`), returns
   *   the cached plaintext synchronously without consulting the SDK.
   * - Otherwise (read-side handle without a cached plaintext), invokes
   *   the SDK's single-cell `decrypt` with the handle's routing
   *   context. The caller-supplied `signal` is forwarded to the SDK
   *   by identity per the umbrella cancellation contract.
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
      ...(opts?.signal ? { signal: opts.signal } : {}),
    });
    handle.plaintext = plaintext;
    return plaintext;
  }

  /**
   * `JSON.stringify(envelope)` produces a non-revealing placeholder
   * regardless of which slot of the handle is populated. Without this
   * override, `JSON.stringify` would still produce `{}` (since handle
   * data lives in a `WeakMap`) — but the placeholder makes the intent
   * explicit and is the documented shape per the open-question
   * default in the envelope-codec spec.
   */
  toJSON(): unknown {
    return { $encryptedString: '<opaque>' };
  }
}
