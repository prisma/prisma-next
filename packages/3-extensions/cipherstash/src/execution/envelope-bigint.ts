/**
 * `EncryptedBigInt` envelope — the user-facing input/output type for
 * `cipherstash/bigint@1` columns. Concrete subclass of
 * {@link EncryptedEnvelopeBase} parameterised on `bigint` (per spec
 * D2; EQL `cast_as = 'big_int'`).
 *
 * No `parseDecryptedValue` override is needed: the SDK's polymorphic
 * decrypt path returns `bigint` plaintexts unchanged per spec D1.
 */

import {
  EncryptedEnvelopeBase,
  type EncryptedEnvelopeFromInternalArgs,
  type EncryptedEnvelopeHandle,
} from './envelope-base';

export type EncryptedBigIntHandle = EncryptedEnvelopeHandle<bigint>;

export type EncryptedBigIntFromInternalArgs = EncryptedEnvelopeFromInternalArgs;

export class EncryptedBigInt extends EncryptedEnvelopeBase<bigint> {
  protected override get typeName(): string {
    return 'EncryptedBigInt';
  }

  /**
   * Construct a write-side envelope from a plaintext `bigint`.
   * Bulk-encrypt middleware populates the handle's ciphertext slot
   * before the codec encodes the envelope to wire format.
   */
  static from(plaintext: bigint): EncryptedBigInt {
    return new EncryptedBigInt({
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
  static fromInternal(args: EncryptedBigIntFromInternalArgs): EncryptedBigInt {
    return new EncryptedBigInt({
      plaintext: undefined,
      ciphertext: args.ciphertext,
      table: args.table,
      column: args.column,
      sdk: args.sdk,
    });
  }
}
