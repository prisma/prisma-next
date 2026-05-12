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

import { CIPHERSTASH_STRING_CODEC_ID } from '../extension-metadata/constants';
import { makeCipherstashCodecHooks } from './codec-hooks-factory';

export const cipherstashStringCodecHooks = makeCipherstashCodecHooks({
  flagToIndex: {
    equality: 'unique',
    freeTextSearch: 'match',
  },
  castAs: 'text',
});

/** Re-export the codec id alongside the hooks so wiring sites import them together. */
export { CIPHERSTASH_STRING_CODEC_ID };
