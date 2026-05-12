/**
 * Control hooks for the `cipherstash:string@1` codec.
 *
 * Implements `CodecControlHooks.onFieldEvent` via the shared
 * {@link makeCipherstashCodecHooks} factory (see
 * `./codec-hooks-factory.ts` for the per-flag walk that's identical
 * across every cipherstash codec). Reacts to per-field added /
 * dropped / altered events as the *application* emitter diffs the
 * prior contract against the new contract; the returned Calls flow
 * through the SQL planner's IR alongside structural DDL and render as
 * `cipherstashAddSearchConfig({...})` /
 * `cipherstashRemoveSearchConfig({...})` calls in the user's
 * `migration.ts` (ADR 195 two-renderer pattern).
 *
 * Trigger: a field uses the `cipherstash:string@1` codec. The planner
 * already dispatches per `(table, field)` based on the field's
 * `codecId` (new field for `'added'` / `'altered'`, prior field for
 * `'dropped'`), so this hook only fires when a cipherstash field is
 * involved. Per field the hook emits one
 * `cipherstashAddSearchConfig` Call per enabled flag in `typeParams`
 * (and one `cipherstashRemoveSearchConfig` Call per previously-enabled
 * flag on drop / altered-off).
 *
 * Flag → EQL index mapping for the string codec:
 *
 *   - `equality: true`        → `'unique'` index
 *   - `freeTextSearch: true`  → `'match'`  index
 *
 * `cast_as` is `'text'` for every string-codec search-config row; the
 * EQL bundle's expected cast for `eql_v2_encrypted` columns derived
 * from a `text` plaintext.
 */

import {
  CIPHERSTASH_BIGINT_CODEC_ID,
  CIPHERSTASH_BOOLEAN_CODEC_ID,
  CIPHERSTASH_DATE_CODEC_ID,
  CIPHERSTASH_DOUBLE_CODEC_ID,
  CIPHERSTASH_JSON_CODEC_ID,
  CIPHERSTASH_STRING_CODEC_ID,
} from '../extension-metadata/constants';
import { makeCipherstashCodecHooks } from './codec-hooks-factory';

export const cipherstashStringCodecHooks = makeCipherstashCodecHooks({
  flagToIndex: {
    equality: 'unique',
    freeTextSearch: 'match',
    orderAndRange: 'ore',
  },
  castAs: 'text',
});

/**
 * Codec lifecycle hooks for `cipherstash/double@1`. The numeric codecs
 * share the `{ equality, orderAndRange }` flag set and differ only in
 * `cast_as` (`double` vs `big_int`). See spec D2 for the codec id
 * naming rationale.
 */
export const cipherstashDoubleCodecHooks = makeCipherstashCodecHooks({
  flagToIndex: {
    equality: 'unique',
    orderAndRange: 'ore',
  },
  castAs: 'double',
});

/** Codec lifecycle hooks for `cipherstash/bigint@1`. */
export const cipherstashBigIntCodecHooks = makeCipherstashCodecHooks({
  flagToIndex: {
    equality: 'unique',
    orderAndRange: 'ore',
  },
  castAs: 'big_int',
});

/**
 * Codec lifecycle hooks for `cipherstash/date@1`. Calendar-date plaintext
 * (no time component) — flag set mirrors the numeric codecs because EQL
 * supports both equality (unique-index) and order/range (ORE-index)
 * predicates over dates.
 */
export const cipherstashDateCodecHooks = makeCipherstashCodecHooks({
  flagToIndex: {
    equality: 'unique',
    orderAndRange: 'ore',
  },
  castAs: 'date',
});

/**
 * Codec lifecycle hooks for `cipherstash/boolean@1`. Booleans only
 * support equality search (a 2-value domain has no meaningful range
 * predicate), so the flag set collapses to `{ equality }`.
 */
export const cipherstashBooleanCodecHooks = makeCipherstashCodecHooks({
  flagToIndex: {
    equality: 'unique',
  },
  castAs: 'boolean',
});

/**
 * Codec lifecycle hooks for `cipherstash/json@1`. EQL exposes structured
 * JSON predicates through the `ste_vec` (Structured Encryption Vector)
 * index family — a single flag (`searchableJson`) gates the entire
 * suite of containment / path-extraction operators.
 */
export const cipherstashJsonCodecHooks = makeCipherstashCodecHooks({
  flagToIndex: {
    searchableJson: 'ste_vec',
  },
  castAs: 'jsonb',
});

/** Re-export the codec ids alongside the hooks so wiring sites import them together. */
export {
  CIPHERSTASH_BIGINT_CODEC_ID,
  CIPHERSTASH_BOOLEAN_CODEC_ID,
  CIPHERSTASH_DATE_CODEC_ID,
  CIPHERSTASH_DOUBLE_CODEC_ID,
  CIPHERSTASH_JSON_CODEC_ID,
  CIPHERSTASH_STRING_CODEC_ID,
};
