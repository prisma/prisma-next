/**
 * `EncryptedDouble` envelope — the user-facing input/output type for
 * `cipherstash/double@1` columns. Concrete subclass of
 * {@link EncryptedEnvelopeBase} parameterised on `number` (IEEE-754
 * double; EQL `cast_as = 'double'`). Mirrors `EncryptedString`
 * byte-for-byte beyond the typed factories and `typeName`.
 *
 * No `parseDecryptedValue` override is needed: the SDK's polymorphic
 * `bulkDecrypt` / single-cell `decrypt` already returns numeric
 * plaintexts as `number`; the base's default identity cast suffices.
 */

import {
  EncryptedEnvelopeBase,
  type EncryptedEnvelopeFromInternalArgs,
  type EncryptedEnvelopeHandle,
} from './envelope-base';

export type EncryptedDoubleHandle = EncryptedEnvelopeHandle<number>;

export type EncryptedDoubleFromInternalArgs = EncryptedEnvelopeFromInternalArgs;

export class EncryptedDouble extends EncryptedEnvelopeBase<number> {
  protected override get typeName(): string {
    return 'EncryptedDouble';
  }

  /**
   * Construct a write-side envelope from a plaintext IEEE-754 number.
   * Bulk-encrypt middleware populates the handle's ciphertext slot
   * before the codec encodes the envelope to wire format.
   */
  static from(plaintext: number): EncryptedDouble {
    return new EncryptedDouble({
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
  static fromInternal(args: EncryptedDoubleFromInternalArgs): EncryptedDouble {
    return new EncryptedDouble({
      plaintext: undefined,
      ciphertext: args.ciphertext,
      table: args.table,
      column: args.column,
      sdk: args.sdk,
    });
  }
}
