/**
 * `EncryptedString` envelope — the user-facing input/output type for
 * `cipherstash/string@1` columns. The class is the first concrete
 * subclass of `EncryptedEnvelopeBase<T>` (see `./envelope-base.ts` for
 * the shared encapsulation pattern, decrypt body, and redaction
 * overrides). It supplies the typed factories (`from(plaintext)`,
 * `fromInternal({...})`) and the user-facing `typeName`; the SDK's
 * single-cell `decrypt` already returns `Promise<string>`, so no
 * `parseDecryptedValue` override is needed.
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

import {
  EncryptedEnvelopeBase,
  type EncryptedEnvelopeFromInternalArgs,
  type EncryptedEnvelopeHandle,
} from './envelope-base';

export type EncryptedStringHandle = EncryptedEnvelopeHandle<string>;

export type EncryptedStringFromInternalArgs = EncryptedEnvelopeFromInternalArgs;

export class EncryptedString extends EncryptedEnvelopeBase<string> {
  protected override get typeName(): string {
    return 'EncryptedString';
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
}

export {
  isHandleDecrypted,
  setHandleCiphertext,
  setHandlePlaintextCache,
  setHandleRoutingKey,
} from './envelope-base';
