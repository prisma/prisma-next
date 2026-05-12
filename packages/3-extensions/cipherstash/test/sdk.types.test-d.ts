/**
 * Type-shape tests pinning the polymorphic `CipherstashSdk` boundary.
 *
 * Each batch the SDK sees is homogeneously typed by its `(table, column)`
 * routing key, so the SDK accepts and returns `ReadonlyArray<unknown>`
 * — no per-batch `cast_as` hint is needed at the framework boundary.
 *
 * Negative cases use `@ts-expect-error` per `AGENTS.md § Typesafety
 * rules` (negative type tests are the documented carve-out).
 */

import type {
  CipherstashBulkDecryptArgs,
  CipherstashBulkEncryptArgs,
  CipherstashSdk,
} from '../src/execution/sdk';

declare const sdk: CipherstashSdk;
declare const routingKey: { readonly table: string; readonly column: string };
declare const unknownValues: ReadonlyArray<unknown>;
declare const unknownCiphertexts: ReadonlyArray<unknown>;
declare const stringValues: ReadonlyArray<string>;
declare const numberValues: ReadonlyArray<number>;
declare const dateValues: ReadonlyArray<Date>;

// --- Positive: polymorphic in / out ----------------------------------

const _encryptUnknown: Promise<ReadonlyArray<unknown>> = sdk.bulkEncrypt({
  routingKey,
  values: unknownValues,
});
void _encryptUnknown;

const _decryptUnknown: Promise<ReadonlyArray<unknown>> = sdk.bulkDecrypt({
  routingKey,
  ciphertexts: unknownCiphertexts,
});
void _decryptUnknown;

// Concrete subtypes flow in via natural variance — no per-codec adapter
// is required at the framework boundary.
void sdk.bulkEncrypt({ routingKey, values: stringValues });
void sdk.bulkEncrypt({ routingKey, values: numberValues });
void sdk.bulkEncrypt({ routingKey, values: dateValues });

// Args expose `values` and `ciphertexts` as `ReadonlyArray<unknown>`.
const _argsAreUnknown: ReadonlyArray<unknown> = (null as unknown as CipherstashBulkEncryptArgs)
  .values;
const _ciphertextsAreUnknown: ReadonlyArray<unknown> = (
  null as unknown as CipherstashBulkDecryptArgs
).ciphertexts;
void _argsAreUnknown;
void _ciphertextsAreUnknown;

// --- Negative: a string-only `bulkEncrypt` rejects `ReadonlyArray<unknown>`

// A hypothetical narrower contract: `values` typed as `ReadonlyArray<string>`.
// Callers who pass a polymorphic batch (the actual contract D1 locks in)
// no longer compile — proving the polymorphic shape is what makes the
// framework boundary work.
declare const narrowedBulkEncrypt: (args: {
  readonly routingKey: { readonly table: string; readonly column: string };
  readonly values: ReadonlyArray<string>;
}) => Promise<ReadonlyArray<unknown>>;

// @ts-expect-error — `ReadonlyArray<unknown>` is not assignable to
// `ReadonlyArray<string>`. The polymorphic SDK boundary exists
// precisely so non-string codecs (Double, Date, BigInt, ...) can pass
// their batches through without per-codec adapters.
void narrowedBulkEncrypt({ routingKey, values: unknownValues });

// `bulkDecrypt` has no symmetric negative case: a `Promise<ReadonlyArray<string>>`
// return is a *refinement* of the polymorphic `Promise<ReadonlyArray<unknown>>`
// return (covariance permits it). The framework boundary still requires the
// wide return so the per-envelope `parseDecryptedValue` hook can narrow each
// codec's plaintext to its own `T` (e.g. `EncryptedDate` returns a `Date`).
// Pin the wide-return shape via the positive `_decryptUnknown` check above.
