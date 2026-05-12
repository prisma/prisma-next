/**
 * Shared factory for every cipherstash codec's `CodecControlHooks`.
 *
 * Every cipherstash codec (`cipherstash/string@1`, `cipherstash/double@1`,
 * `cipherstash/bigint@1`, `cipherstash/date@1`, `cipherstash/boolean@1`,
 * `cipherstash/json@1`) exposes the same hook-shape:
 *
 *   - one `cipherstashAddSearchConfig` Call per enabled flag in
 *     `typeParams` on `'added'` / `'altered'`-flipped-on;
 *   - one `cipherstashRemoveSearchConfig` Call per previously-enabled
 *     flag on `'dropped'` / `'altered'`-flipped-off;
 *   - identity `expandNativeType` (the cipherstash `nativeType` is
 *     always `eql_v2_encrypted`; per-flag wiring is delivered by the
 *     `add_search_config` rows, not by widening the column type).
 *
 * Each codec configures the factory with two values that vary per
 * codec:
 *
 *   - `flagToIndex` — the codec's `typeParams` flag names mapped to the
 *     EQL `add_search_config` index name they enable (e.g.
 *     `equality → 'unique'`, `freeTextSearch → 'match'`,
 *     `orderAndRange → 'ore'`, `searchableJson → 'ste_vec'`).
 *   - `castAs` — the EQL `cast_as` argument passed to
 *     `eql_v2.add_search_config(...)` for every flag this codec emits.
 *     Static per codec (e.g. string → `'text'`, double → `'double'`).
 *
 * The factory's `onFieldEvent` body is otherwise identical across
 * codecs — collapsing the ~80-line per-flag walk into one place. See
 * spec D4 for the rationale and the per-codec config table.
 *
 * @see ../../../../projects/cipherstash-integration/project-2/spec.md (D4)
 */

import type { CodecControlHooks, FieldEventContext } from '@prisma-next/family-sql/control';
import type { OpFactoryCall } from '@prisma-next/framework-components/control';
import {
  type CipherstashSearchIndex,
  cipherstashAddSearchConfig,
  cipherstashRemoveSearchConfig,
} from './call-classes';

export interface MakeCipherstashCodecHooksOptions {
  /**
   * `typeParams` flag names mapped to the EQL search-config index each
   * enables. The factory walks every key in this record per
   * `onFieldEvent` invocation; the order is irrelevant to ops.json
   * because the planner re-canonicalises the call list, but stable
   * key ordering keeps debug output predictable.
   */
  readonly flagToIndex: Readonly<Record<string, CipherstashSearchIndex>>;
  /**
   * EQL `cast_as` argument for every `add_search_config` call this
   * codec emits. Static per codec — see spec D4.
   */
  readonly castAs: string;
}

function isEnabled(
  typeParams: Readonly<Record<string, unknown>> | undefined,
  flag: string,
): boolean {
  return typeParams !== undefined && typeParams[flag] === true;
}

/**
 * Construct the `CodecControlHooks` for a cipherstash codec given its
 * per-codec flag-to-index mapping and `cast_as`.
 *
 * Pure and synchronous — the returned hook replays deterministically
 * when the application emitter re-diffs the contract.
 */
export function makeCipherstashCodecHooks(
  options: MakeCipherstashCodecHooksOptions,
): CodecControlHooks {
  const { flagToIndex, castAs } = options;
  const allFlags = Object.keys(flagToIndex);

  function onFieldEvent(
    event: 'added' | 'dropped' | 'altered',
    ctx: FieldEventContext,
  ): readonly OpFactoryCall[] {
    const { tableName, fieldName, priorField, newField } = ctx;

    if (event === 'added') {
      if (newField === undefined) return [];
      const calls: OpFactoryCall[] = [];
      for (const flag of allFlags) {
        if (isEnabled(newField.typeParams, flag)) {
          calls.push(
            cipherstashAddSearchConfig({
              table: tableName,
              column: fieldName,
              index: flagToIndex[flag] as CipherstashSearchIndex,
              castAs,
            }),
          );
        }
      }
      return calls;
    }

    if (event === 'dropped') {
      if (priorField === undefined) return [];
      const calls: OpFactoryCall[] = [];
      for (const flag of allFlags) {
        if (isEnabled(priorField.typeParams, flag)) {
          calls.push(
            cipherstashRemoveSearchConfig({
              table: tableName,
              column: fieldName,
              index: flagToIndex[flag] as CipherstashSearchIndex,
            }),
          );
        }
      }
      return calls;
    }

    if (priorField === undefined || newField === undefined) return [];
    const calls: OpFactoryCall[] = [];
    for (const flag of allFlags) {
      const before = isEnabled(priorField.typeParams, flag);
      const after = isEnabled(newField.typeParams, flag);
      if (after && !before) {
        calls.push(
          cipherstashAddSearchConfig({
            table: tableName,
            column: fieldName,
            index: flagToIndex[flag] as CipherstashSearchIndex,
            castAs,
          }),
        );
      } else if (before && !after) {
        calls.push(
          cipherstashRemoveSearchConfig({
            table: tableName,
            column: fieldName,
            index: flagToIndex[flag] as CipherstashSearchIndex,
          }),
        );
      }
    }
    return calls;
  }

  /**
   * The DDL type for any cipherstash column is always
   * `eql_v2_encrypted` regardless of `typeParams` flags: the
   * search-config wiring is delivered by the codec hook's
   * `cipherstashAddSearchConfig` Calls (separate rows in
   * `eql_v2_configuration`), not by the column type itself. Returning
   * `nativeType` unchanged tells the planner "no expansion required" —
   * see `expandParameterizedTypeSql` in
   * `packages/3-targets/3-targets/postgres/src/core/migrations/planner-ddl-builders.ts`,
   * which only requires this hook to *exist* for any column carrying
   * `typeParams`.
   */
  const expandNativeType: NonNullable<CodecControlHooks['expandNativeType']> = ({ nativeType }) =>
    nativeType;

  return { onFieldEvent, expandNativeType };
}
