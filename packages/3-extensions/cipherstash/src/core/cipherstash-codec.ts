/**
 * Control hooks for the `cipherstash:string@1` codec.
 *
 * Implements `CodecControlHooks.onFieldEvent` per the framework-
 * mechanism sub-spec § 5 and the cipherstash sub-spec § 4. Reacts to
 * per-field added / dropped / altered events as the *application*
 * emitter diffs the prior contract against the new contract; the
 * returned ops are inlined into the application's migration alongside
 * the user's structural ops by the SQL planner
 * (`planFieldEventOperations` in `@prisma-next/family-sql/control`).
 *
 * Trigger: a field uses the `cipherstash:string@1` codec. The planner
 * already dispatches per `(table, field)` based on the field's
 * `codecId` (new field for `'added'` / `'altered'`, prior field for
 * `'dropped'`), so this hook only fires when a cipherstash field is
 * involved. Per field the hook emits **one `add_search_config@v1` op
 * per enabled flag** in `typeParams` (and one `remove_search_config@v1`
 * op per previously-enabled flag on drop / altered-off).
 *
 * Flag → EQL index mapping:
 *
 *   - `equality: true`        → `'unique'` index
 *   - `freeTextSearch: true`  → `'match'`  index
 *
 * One op per flag (rather than a single multi-statement op per field)
 * keeps each op independently invertible by a paired
 * `remove_search_config@v1` op carrying the same index name, and the
 * op-graph stays per-flag granular for diffing.
 *
 * `'altered'` events decompose into per-flag deltas:
 *   - flag flipped on  → emit `add_search_config:<index>@v1`.
 *   - flag flipped off → emit `remove_search_config:<index>@v1`.
 *   - flag unchanged   → no op.
 *
 * `invariantId` template:
 *   `cipherstash-codec:<table>.<field>:<action>:<index>@v1`
 *   `<action>` ∈ `'add-search-config' | 'remove-search-config'`,
 *   `<index>` ∈ `'unique' | 'match'`.
 * Stable across regenerations because every input is deterministic.
 */

import type {
  CodecControlHooks,
  FieldEventContext,
  SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import { CIPHERSTASH_STRING_CODEC_ID } from './constants';

type Op = SqlMigrationPlanOperation<unknown>;

type FlagName = 'equality' | 'freeTextSearch';
type IndexName = 'unique' | 'match';

const FLAG_TO_INDEX: Readonly<Record<FlagName, IndexName>> = {
  equality: 'unique',
  freeTextSearch: 'match',
};

const ALL_FLAGS: ReadonlyArray<FlagName> = ['equality', 'freeTextSearch'];

/** Mirrors `eql_v2.add_search_config(table, column, index_name, cast_as)`. */
const DEFAULT_CAST_AS = 'text';

function isEnabled(
  typeParams: Readonly<Record<string, unknown>> | undefined,
  flag: FlagName,
): boolean {
  return typeParams !== undefined && typeParams[flag] === true;
}

/**
 * Escape a string so it can be embedded inside a Postgres single-quoted
 * literal. Identifiers in our IR are unlikely to contain apostrophes,
 * but doubling them keeps the emitted SQL safe under any future
 * relaxation.
 */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function addSearchConfigSql(tableName: string, fieldName: string, indexName: IndexName): string {
  return `SELECT eql_v2.add_search_config(${sqlLiteral(tableName)}, ${sqlLiteral(fieldName)}, ${sqlLiteral(indexName)}, ${sqlLiteral(DEFAULT_CAST_AS)});`;
}

function removeSearchConfigSql(tableName: string, fieldName: string, indexName: IndexName): string {
  return `SELECT eql_v2.remove_search_config(${sqlLiteral(tableName)}, ${sqlLiteral(fieldName)}, ${sqlLiteral(indexName)});`;
}

function invariantId(
  tableName: string,
  fieldName: string,
  action: string,
  indexName: IndexName,
): string {
  return `cipherstash-codec:${tableName}.${fieldName}:${action}:${indexName}@v1`;
}

function buildAddOp(tableName: string, fieldName: string, indexName: IndexName): Op {
  return {
    id: `cipherstash-codec.${tableName}.${fieldName}.add-search-config.${indexName}`,
    label: `Register cipherstash search config (${indexName}) for ${tableName}.${fieldName}`,
    operationClass: 'additive',
    invariantId: invariantId(tableName, fieldName, 'add-search-config', indexName),
    target: { id: 'postgres' },
    precheck: [],
    execute: [
      {
        description: `Register cipherstash ${indexName} search config for ${tableName}.${fieldName}`,
        sql: addSearchConfigSql(tableName, fieldName, indexName),
      },
    ],
    postcheck: [],
  };
}

function buildRemoveOp(tableName: string, fieldName: string, indexName: IndexName): Op {
  return {
    id: `cipherstash-codec.${tableName}.${fieldName}.remove-search-config.${indexName}`,
    label: `Remove cipherstash search config (${indexName}) for ${tableName}.${fieldName}`,
    operationClass: 'destructive',
    invariantId: invariantId(tableName, fieldName, 'remove-search-config', indexName),
    target: { id: 'postgres' },
    precheck: [],
    execute: [
      {
        description: `Remove cipherstash ${indexName} search config for ${tableName}.${fieldName}`,
        sql: removeSearchConfigSql(tableName, fieldName, indexName),
      },
    ],
    postcheck: [],
  };
}

/**
 * Hook entry point. Called by `planFieldEventOperations` for every per-
 * field delta dispatched to `cipherstash:string@1`. Pure and
 * synchronous; callers replay it deterministically when re-emitting.
 */
function onFieldEvent(
  event: 'added' | 'dropped' | 'altered',
  ctx: FieldEventContext,
): readonly Op[] {
  const { tableName, fieldName, priorField, newField } = ctx;

  if (event === 'added') {
    if (newField === undefined) return [];
    const ops: Op[] = [];
    for (const flag of ALL_FLAGS) {
      if (isEnabled(newField.typeParams, flag)) {
        ops.push(buildAddOp(tableName, fieldName, FLAG_TO_INDEX[flag]));
      }
    }
    return ops;
  }

  if (event === 'dropped') {
    if (priorField === undefined) return [];
    const ops: Op[] = [];
    for (const flag of ALL_FLAGS) {
      if (isEnabled(priorField.typeParams, flag)) {
        ops.push(buildRemoveOp(tableName, fieldName, FLAG_TO_INDEX[flag]));
      }
    }
    return ops;
  }

  if (priorField === undefined || newField === undefined) return [];
  const ops: Op[] = [];
  for (const flag of ALL_FLAGS) {
    const before = isEnabled(priorField.typeParams, flag);
    const after = isEnabled(newField.typeParams, flag);
    if (after && !before) {
      ops.push(buildAddOp(tableName, fieldName, FLAG_TO_INDEX[flag]));
    } else if (before && !after) {
      ops.push(buildRemoveOp(tableName, fieldName, FLAG_TO_INDEX[flag]));
    }
  }
  return ops;
}

/**
 * The DDL type for an `Encrypted<string>` column is always
 * `eql_v2_encrypted` regardless of any `typeParams` flags: the
 * search-config wiring is delivered by the codec hook's
 * `add_search_config` ops (separate rows in `eql_v2_configuration`),
 * not by the column type itself. Returning `nativeType` unchanged
 * tells the planner "no expansion required" — see
 * `expandParameterizedTypeSql` in
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
