/**
 * `EncryptedJson` envelope — the user-facing input/output type for
 * `cipherstash/json@1` columns. Concrete subclass of
 * {@link EncryptedEnvelopeBase} parameterised on `unknown`
 * (JSON-serialisable; EQL `cast_as = 'jsonb'`).
 *
 * The plaintext slot intentionally types as `unknown` rather than a
 * tighter `JsonValue`-style alias: cipherstash users routinely round-
 * trip arbitrary nested JS objects through encrypted JSON columns,
 * and forcing them through a stricter compile-time alias just shifts
 * casts to call sites. Runtime safety is the SDK's responsibility
 * (the bulk-encrypt path JSON-stringifies the value, surfacing any
 * non-serialisable shape as an SDK-level error).
 *
 * No `parseDecryptedValue` override is needed: the SDK's polymorphic
 * decrypt path returns the decoded JSON value as-is.
 */

import {
  EncryptedEnvelopeBase,
  type EncryptedEnvelopeFromInternalArgs,
  type EncryptedEnvelopeHandle,
} from './envelope-base';

export type EncryptedJsonHandle = EncryptedEnvelopeHandle<unknown>;

export type EncryptedJsonFromInternalArgs = EncryptedEnvelopeFromInternalArgs;

export class EncryptedJson extends EncryptedEnvelopeBase<unknown> {
  protected override get typeName(): string {
    return 'EncryptedJson';
  }

  static from(plaintext: unknown): EncryptedJson {
    return new EncryptedJson({
      plaintext,
      ciphertext: undefined,
      table: undefined,
      column: undefined,
      sdk: undefined,
    });
  }

  static fromInternal(args: EncryptedJsonFromInternalArgs): EncryptedJson {
    return new EncryptedJson({
      plaintext: undefined,
      ciphertext: args.ciphertext,
      table: args.table,
      column: args.column,
      sdk: args.sdk,
    });
  }
}
