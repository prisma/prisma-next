/**
 * Control hooks for the `cipherstash:string@1` codec.
 *
 * Implements `CodecControlHooks.onFieldEvent` per the framework-
 * mechanism sub-spec § 5 and the cipherstash sub-spec § 4. Reacts to
 * per-field added / dropped / altered events as the *application*
 * emitter diffs the prior contract against the new contract; the
 * returned Calls flow through the SQL planner's IR alongside structural
 * DDL and render as `cipherstashAddSearchConfig({...})` /
 * `cipherstashRemoveSearchConfig({...})` calls in the user's
 * `migration.ts` (sub-spec § 5; ADR 195 two-renderer pattern).
 *
 * Trigger: a field uses the `cipherstash:string@1` codec. The planner
 * already dispatches per `(table, field)` based on the field's
 * `codecId` (new field for `'added'` / `'altered'`, prior field for
 * `'dropped'`), so this hook only fires when a cipherstash field is
 * involved. Per field the hook emits **one
 * `cipherstashAddSearchConfig` Call per enabled flag** in `typeParams`
 * (and one `cipherstashRemoveSearchConfig` Call per previously-enabled
 * flag on drop / altered-off).
 *
 * Flag → EQL index mapping:
 *
 *   - `equality: true`        → `'unique'` index
 *   - `freeTextSearch: true`  → `'match'`  index
 *
 * One Call per flag (rather than a single multi-statement Call per
 * field) keeps each Call independently invertible by a paired
 * `cipherstashRemoveSearchConfig` Call carrying the same index name,
 * and the op-graph stays per-flag granular for diffing.
 *
 * `'altered'` events decompose into per-flag deltas:
 *   - flag flipped on  → emit `cipherstashAddSearchConfig({...})`.
 *   - flag flipped off → emit `cipherstashRemoveSearchConfig({...})`.
 *   - flag unchanged   → no Call.
 *
 * `invariantId` template (carried on the Call's `toOp()` output):
 *   `cipherstash-codec:<table>.<field>:<action>:<index>@v1`
 *   `<action>` ∈ `'add-search-config' | 'remove-search-config'`,
 *   `<index>` ∈ `'unique' | 'match'`.
 * Stable across regenerations because every input is deterministic.
 */

import type { CodecControlHooks, FieldEventContext } from '@prisma-next/family-sql/control';
import type { OpFactoryCall } from '@prisma-next/framework-components/control';
import { CIPHERSTASH_STRING_CODEC_ID } from './constants';
import {
  type CipherstashSearchIndex,
  cipherstashAddSearchConfig,
  cipherstashRemoveSearchConfig,
} from './migration-call-classes';

type FlagName = 'equality' | 'freeTextSearch';

const FLAG_TO_INDEX: Readonly<Record<FlagName, CipherstashSearchIndex>> = {
  equality: 'unique',
  freeTextSearch: 'match',
};

const ALL_FLAGS: ReadonlyArray<FlagName> = ['equality', 'freeTextSearch'];

function isEnabled(
  typeParams: Readonly<Record<string, unknown>> | undefined,
  flag: FlagName,
): boolean {
  return typeParams !== undefined && typeParams[flag] === true;
}

/**
 * Hook entry point. Called by `planFieldEventOperations` for every per-
 * field delta dispatched to `cipherstash:string@1`. Pure and
 * synchronous; callers replay it deterministically when re-emitting.
 */
function onFieldEvent(
  event: 'added' | 'dropped' | 'altered',
  ctx: FieldEventContext,
): readonly OpFactoryCall[] {
  const { tableName, fieldName, priorField, newField } = ctx;

  if (event === 'added') {
    if (newField === undefined) return [];
    const calls: OpFactoryCall[] = [];
    for (const flag of ALL_FLAGS) {
      if (isEnabled(newField.typeParams, flag)) {
        calls.push(
          cipherstashAddSearchConfig({
            table: tableName,
            column: fieldName,
            index: FLAG_TO_INDEX[flag],
          }),
        );
      }
    }
    return calls;
  }

  if (event === 'dropped') {
    if (priorField === undefined) return [];
    const calls: OpFactoryCall[] = [];
    for (const flag of ALL_FLAGS) {
      if (isEnabled(priorField.typeParams, flag)) {
        calls.push(
          cipherstashRemoveSearchConfig({
            table: tableName,
            column: fieldName,
            index: FLAG_TO_INDEX[flag],
          }),
        );
      }
    }
    return calls;
  }

  if (priorField === undefined || newField === undefined) return [];
  const calls: OpFactoryCall[] = [];
  for (const flag of ALL_FLAGS) {
    const before = isEnabled(priorField.typeParams, flag);
    const after = isEnabled(newField.typeParams, flag);
    if (after && !before) {
      calls.push(
        cipherstashAddSearchConfig({
          table: tableName,
          column: fieldName,
          index: FLAG_TO_INDEX[flag],
        }),
      );
    } else if (before && !after) {
      calls.push(
        cipherstashRemoveSearchConfig({
          table: tableName,
          column: fieldName,
          index: FLAG_TO_INDEX[flag],
        }),
      );
    }
  }
  return calls;
}

/**
 * The DDL type for an `Encrypted<string>` column is always
 * `eql_v2_encrypted` regardless of any `typeParams` flags: the
 * search-config wiring is delivered by the codec hook's
 * `cipherstashAddSearchConfig` Calls (separate rows in
 * `eql_v2_configuration`), not by the column type itself. Returning
 * `nativeType` unchanged tells the planner "no expansion required" —
 * see `expandParameterizedTypeSql` in
 * `packages/3-targets/3-targets/postgres/src/core/migrations/planner-ddl-builders.ts`,
 * which only requires this hook to *exist* for any column carrying
 * `typeParams`. Without it, the planner refuses to render the column
 * (the existing arktype-json extension wires the same identity hook).
 */
const expandNativeType: NonNullable<CodecControlHooks['expandNativeType']> = ({ nativeType }) =>
  nativeType;

export const cipherstashStringCodecHooks: CodecControlHooks = { onFieldEvent, expandNativeType };

/** Re-export the codec id alongside the hooks so wiring sites import them together. */
export { CIPHERSTASH_STRING_CODEC_ID };
