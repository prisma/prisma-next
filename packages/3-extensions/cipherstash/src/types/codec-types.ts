/**
 * Codec type definitions for the cipherstash extension.
 *
 * Type-only definitions for codec input/output/traits — consumed by
 * the contract emitter when generating an application's
 * `contract.d.ts`. Importing this subpath registers every cipherstash
 * codec id with its `cipherstash:*` traits, so trait-dispatched
 * operators (`cipherstashGt`, `cipherstashBetween`,
 * `cipherstashInArray`, …) surface on real model accessors.
 *
 * # Why this is hand-written, not derived via `ExtractCodecTypes`
 *
 * The framework's `ExtractCodecTypes` helper projects descriptor-keyed
 * types via `traits: TTraits[number] & CodecTrait`. The framework's
 * `CodecTrait` is a closed union of built-ins (`'equality'`,
 * `'order'`, `'numeric'`, `'boolean'`, `'textual'`); the cipherstash
 * trait strings (`'cipherstash:equality'`, `'cipherstash:order-and-range'`,
 * `'cipherstash:free-text-search'`, `'cipherstash:searchable-json'`)
 * deliberately sit outside that union (per spec D7 + the
 * `equality-trait-removal.test.ts` regression — namespacing isolates
 * the cipherstash dispatch surface from framework built-in operators
 * like `eq` that would lower to standard SQL `=`, which is wrong for
 * EQL ciphertexts). Running cipherstash descriptors through
 * `ExtractCodecTypes` would intersect each trait string with
 * `CodecTrait` and collapse to `never`, defeating the whole point of
 * the augmentation.
 *
 * The hand-written shape preserves the literal trait strings so the
 * model accessor's trait-dispatch type-level lookup
 * (`SqlQueryOperationTypes` → `OpMatchesField`) sees the actual
 * cipherstash trait names and surfaces the right operator on the
 * right column.
 *
 * # Output type uses the envelope class
 *
 * Each codec's runtime `decode` returns an `EncryptedEnvelopeBase`
 * subclass instance. The `output` slot here is the envelope class so
 * `FieldOutputTypes['User']['email']` resolves to `EncryptedString`
 * (and the ORM read path returns an envelope the user calls
 * `.decrypt()` on); `input` is the union of the envelope class and
 * the bare plaintext, mirroring the polymorphic argument shapes the
 * predicate operators accept (`coerceToEnvelope` in
 * `src/execution/operators.ts`).
 */

import type { EncryptedString } from '../execution/envelope';
// Type-only imports — the codec-types subpath compiles to an empty
// JS module under tsdown (every import below is elided), so importing
// the envelope classes by type carries no runtime cost in the
// generated `codec-types.mjs` chunk.
import type { EncryptedBigInt } from '../execution/envelope-bigint';
import type { EncryptedBoolean } from '../execution/envelope-boolean';
import type { EncryptedDate } from '../execution/envelope-date';
import type { EncryptedDouble } from '../execution/envelope-double';
import type { EncryptedJson } from '../execution/envelope-json';

export type CodecTypes = {
  readonly 'cipherstash/string@1': {
    readonly input: string | EncryptedString;
    readonly output: EncryptedString;
    readonly traits:
      | 'cipherstash:equality'
      | 'cipherstash:free-text-search'
      | 'cipherstash:order-and-range';
  };
  readonly 'cipherstash/double@1': {
    readonly input: number | EncryptedDouble;
    readonly output: EncryptedDouble;
    readonly traits: 'cipherstash:equality' | 'cipherstash:order-and-range';
  };
  readonly 'cipherstash/bigint@1': {
    readonly input: bigint | EncryptedBigInt;
    readonly output: EncryptedBigInt;
    readonly traits: 'cipherstash:equality' | 'cipherstash:order-and-range';
  };
  readonly 'cipherstash/date@1': {
    readonly input: Date | EncryptedDate;
    readonly output: EncryptedDate;
    readonly traits: 'cipherstash:equality' | 'cipherstash:order-and-range';
  };
  readonly 'cipherstash/boolean@1': {
    readonly input: boolean | EncryptedBoolean;
    readonly output: EncryptedBoolean;
    readonly traits: 'cipherstash:equality';
  };
  readonly 'cipherstash/json@1': {
    readonly input: unknown | EncryptedJson;
    readonly output: EncryptedJson;
    readonly traits: 'cipherstash:searchable-json';
  };
};
