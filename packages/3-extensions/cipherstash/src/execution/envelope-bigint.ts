/**
 * `EncryptedBigInt` envelope — the user-facing input/output type for
 * `cipherstash/bigint@1` columns. Concrete subclass of
 * {@link EncryptedEnvelopeBase} parameterised on `bigint`; lowers to
 * EQL `cast_as = 'big_int'`.
 *
 * The SDK's polymorphic decrypt path returns the bigint plaintext in
 * whatever shape the wire-format choice surfaces — today, the
 * `@cipherstash/stack` SDK serialises `cast_as: 'big_int'` cells as
 * JS `number` (limited by `Number.MAX_SAFE_INTEGER`; see the example
 * SDK adapter's `toJsPlaintext` for the encrypt-side cap). This
 * envelope's `parseDecryptedValue` widens the accepted set so the
 * caller still observes a `bigint` end-to-end regardless of whether
 * the SDK hands us a `bigint` (future-proof) or a `number` (today).
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
   * Narrow the SDK's `unknown` plaintext to a `bigint`.
   *
   * Accepts:
   *   - `bigint` — passed through unchanged.
   *   - `number` — converted via `BigInt(...)`; the SDK's `big_int`
   *     cast presently surfaces values up to `Number.MAX_SAFE_INTEGER`
   *     in this shape.
   *   - `string` — accepted defensively (some SDK builds round-trip
   *     bigints through their decimal-string representation);
   *     non-numeric strings throw.
   *
   * Any other shape throws with a descriptive error rather than
   * letting the caller observe a silently coerced value downstream.
   */
  protected override parseDecryptedValue(sdkResult: unknown): bigint {
    if (typeof sdkResult === 'bigint') {
      return sdkResult;
    }
    if (typeof sdkResult === 'number') {
      if (!Number.isFinite(sdkResult) || !Number.isInteger(sdkResult)) {
        throw new Error(
          `EncryptedBigInt.parseDecryptedValue: SDK returned a non-integer number (${sdkResult}); ` +
            'expected an integer or bigint plaintext.',
        );
      }
      return BigInt(sdkResult);
    }
    if (typeof sdkResult === 'string') {
      try {
        return BigInt(sdkResult);
      } catch {
        throw new Error(
          `EncryptedBigInt.parseDecryptedValue: cannot construct a bigint from SDK plaintext "${sdkResult}".`,
        );
      }
    }
    throw new Error(
      `EncryptedBigInt.parseDecryptedValue: unsupported SDK plaintext type "${typeof sdkResult}"; expected bigint | number | string.`,
    );
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
