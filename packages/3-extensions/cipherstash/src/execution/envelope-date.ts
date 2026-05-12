/**
 * `EncryptedDate` envelope — the user-facing input/output type for
 * `cipherstash/date@1` columns. Concrete subclass of
 * {@link EncryptedEnvelopeBase} parameterised on `Date` (calendar
 * date; EQL `cast_as = 'date'`).
 *
 * Unlike the other envelopes, `EncryptedDate` is the one codec whose
 * `parseDecryptedValue` actually does runtime narrowing:
 * the SDK's polymorphic `decrypt` returns `unknown`, and the EQL
 * surface accepts an ISO date string on encrypt
 * (`'2023-01-01'::date::text::jsonb` per the inline example in
 * `migration/eql-install.generated.ts:1695`). Whether the SDK
 * surfaces a `Date` or a string back to us is an SDK-internal
 * choice; this hook accepts both shapes (plus numeric epoch ms as a
 * defensive fallback) and produces a `Date` instance for the user.
 *
 * If the SDK surfaces something else, we throw with a descriptive
 * error rather than silently returning an invalid `Date` — the
 * caller would otherwise observe `NaN`-valued dates downstream and
 * have no signal of where the corruption entered the pipeline.
 */

import {
  EncryptedEnvelopeBase,
  type EncryptedEnvelopeFromInternalArgs,
  type EncryptedEnvelopeHandle,
} from './envelope-base';

export type EncryptedDateHandle = EncryptedEnvelopeHandle<Date>;

export type EncryptedDateFromInternalArgs = EncryptedEnvelopeFromInternalArgs;

export class EncryptedDate extends EncryptedEnvelopeBase<Date> {
  protected override get typeName(): string {
    return 'EncryptedDate';
  }

  /**
   * Coerce the SDK's `unknown` plaintext into a `Date` instance.
   *
   * Accepts:
   *   - `Date` instance (returned as-is — the SDK may have already
   *     parsed the cell into a JS `Date`).
   *   - `string` (ISO date or ISO datetime — `new Date(value)`
   *     accepts both).
   *   - `number` (epoch milliseconds — defensive fallback).
   *
   * Throws on any other shape; an invalid `Date` (NaN time) is
   * rejected before it can leak downstream.
   */
  protected override parseDecryptedValue(sdkResult: unknown): Date {
    if (sdkResult instanceof Date) {
      if (Number.isNaN(sdkResult.getTime())) {
        throw new Error(
          'EncryptedDate.parseDecryptedValue: SDK returned an invalid Date instance (NaN time).',
        );
      }
      return sdkResult;
    }
    if (typeof sdkResult === 'string' || typeof sdkResult === 'number') {
      const parsed = new Date(sdkResult);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error(
          `EncryptedDate.parseDecryptedValue: cannot construct a Date from SDK plaintext "${String(
            sdkResult,
          )}".`,
        );
      }
      return parsed;
    }
    throw new Error(
      `EncryptedDate.parseDecryptedValue: unsupported SDK plaintext type "${typeof sdkResult}"; expected Date | string | number.`,
    );
  }

  /**
   * Construct a write-side envelope from a `Date` plaintext.
   * Bulk-encrypt middleware populates the handle's ciphertext slot
   * before the codec encodes the envelope to wire format.
   */
  static from(plaintext: Date): EncryptedDate {
    return new EncryptedDate({
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
  static fromInternal(args: EncryptedDateFromInternalArgs): EncryptedDate {
    return new EncryptedDate({
      plaintext: undefined,
      ciphertext: args.ciphertext,
      table: args.table,
      column: args.column,
      sdk: args.sdk,
    });
  }
}
