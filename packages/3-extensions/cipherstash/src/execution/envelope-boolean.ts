/**
 * `EncryptedBoolean` envelope — the user-facing input/output type for
 * `cipherstash/boolean@1` columns. Concrete subclass of
 * {@link EncryptedEnvelopeBase} parameterised on `boolean` (per spec
 * D2; EQL `cast_as = 'boolean'`).
 *
 * No `parseDecryptedValue` override is needed: the SDK's polymorphic
 * decrypt path returns `boolean` plaintexts unchanged per spec D1.
 */

import {
  EncryptedEnvelopeBase,
  type EncryptedEnvelopeFromInternalArgs,
  type EncryptedEnvelopeHandle,
} from './envelope-base';

export type EncryptedBooleanHandle = EncryptedEnvelopeHandle<boolean>;

export type EncryptedBooleanFromInternalArgs = EncryptedEnvelopeFromInternalArgs;

export class EncryptedBoolean extends EncryptedEnvelopeBase<boolean> {
  protected override get typeName(): string {
    return 'EncryptedBoolean';
  }

  static from(plaintext: boolean): EncryptedBoolean {
    return new EncryptedBoolean({
      plaintext,
      ciphertext: undefined,
      table: undefined,
      column: undefined,
      sdk: undefined,
    });
  }

  static fromInternal(args: EncryptedBooleanFromInternalArgs): EncryptedBoolean {
    return new EncryptedBoolean({
      plaintext: undefined,
      ciphertext: args.ciphertext,
      table: args.table,
      column: args.column,
      sdk: args.sdk,
    });
  }
}
