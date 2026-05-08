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
 * Trigger condition: a field uses the `cipherstash:string@1` codec.
 * The planner already dispatches per `(table, field)` based on the
 * field's `codecId` (new field for `'added'` / `'altered'`, prior
 * field for `'dropped'`), so this hook only fires when a cipherstash
 * field is involved. Whether the field also carries `searchable: true`
 * in `typeParams` decides whether any DDL is needed:
 *
 * - `'added'`, `searchable: true`        → emit `add_search_config`.
 * - `'added'`, `searchable !== true`     → no-op (column-type change
 *                                          handled by the user's
 *                                          structural op).
 * - `'dropped'`, was `searchable: true`  → emit `remove_search_config`.
 * - `'dropped'`, was `searchable !== true` → no-op.
 * - `'altered'`, both searchable, other  → rotate (single op carrying
 *   typeParams differ                      `remove` + `add` SQL).
 * - `'altered'`, only new searchable     → emit `add_search_config`.
 * - `'altered'`, only prior searchable   → emit `remove_search_config`.
 * - `'altered'`, neither searchable      → no-op.
 *
 * `invariantId` template: `cipherstash-codec:<table>.<field>:<action>@v1`
 * with `<action>` one of `add-search-config` / `remove-search-config`
 * / `rotate-search-config`. Stable across regenerations because every
 * input is deterministic.
 */

import type {
  CodecControlHooks,
  FieldEventContext,
  SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import { CIPHERSTASH_STRING_CODEC_ID } from './constants';

type Op = SqlMigrationPlanOperation<unknown>;

/**
 * Default index name. Cipherstash's EQL bundle ships several index
 * shapes (`match`, `unique`, `ore`, …); R2 wires a single conservative
 * default that gives every searchable column a usable index. Callers
 * needing finer control can author per-column ops manually until the
 * codec accepts a per-field index-mode parameter.
 */
const DEFAULT_INDEX_NAME = 'match';

/** Mirrors `eql_v2.add_search_config(table, column, index_name, cast_as)`. */
const DEFAULT_CAST_AS = 'text';

function isSearchable(typeParams: Readonly<Record<string, unknown>> | undefined): boolean {
  return typeParams !== undefined && typeParams['searchable'] === true;
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

function addSearchConfigSql(tableName: string, fieldName: string): string {
  return `SELECT eql_v2.add_search_config(${sqlLiteral(tableName)}, ${sqlLiteral(fieldName)}, ${sqlLiteral(DEFAULT_INDEX_NAME)}, ${sqlLiteral(DEFAULT_CAST_AS)});`;
}

function removeSearchConfigSql(tableName: string, fieldName: string): string {
  return `SELECT eql_v2.remove_search_config(${sqlLiteral(tableName)}, ${sqlLiteral(fieldName)});`;
}

function invariantId(tableName: string, fieldName: string, action: string): string {
  return `cipherstash-codec:${tableName}.${fieldName}:${action}@v1`;
}

function buildAddOp(tableName: string, fieldName: string): Op {
  return {
    id: `cipherstash-codec.${tableName}.${fieldName}.add-search-config`,
    label: `Register cipherstash search config for ${tableName}.${fieldName}`,
    operationClass: 'additive',
    invariantId: invariantId(tableName, fieldName, 'add-search-config'),
    target: { id: 'postgres' },
    precheck: [],
    execute: [
      {
        description: `Register cipherstash search config for ${tableName}.${fieldName}`,
        sql: addSearchConfigSql(tableName, fieldName),
      },
    ],
    postcheck: [],
  };
}

function buildRemoveOp(tableName: string, fieldName: string): Op {
  return {
    id: `cipherstash-codec.${tableName}.${fieldName}.remove-search-config`,
    label: `Remove cipherstash search config for ${tableName}.${fieldName}`,
    operationClass: 'destructive',
    invariantId: invariantId(tableName, fieldName, 'remove-search-config'),
    target: { id: 'postgres' },
    precheck: [],
    execute: [
      {
        description: `Remove cipherstash search config for ${tableName}.${fieldName}`,
        sql: removeSearchConfigSql(tableName, fieldName),
      },
    ],
    postcheck: [],
  };
}

function buildRotateOp(tableName: string, fieldName: string): Op {
  return {
    id: `cipherstash-codec.${tableName}.${fieldName}.rotate-search-config`,
    label: `Rotate cipherstash search config for ${tableName}.${fieldName}`,
    operationClass: 'widening',
    invariantId: invariantId(tableName, fieldName, 'rotate-search-config'),
    target: { id: 'postgres' },
    precheck: [],
    execute: [
      {
        description: `Drop existing cipherstash search config for ${tableName}.${fieldName}`,
        sql: removeSearchConfigSql(tableName, fieldName),
      },
      {
        description: `Re-register cipherstash search config for ${tableName}.${fieldName}`,
        sql: addSearchConfigSql(tableName, fieldName),
      },
    ],
    postcheck: [],
  };
}

function paramsDiffer(
  prior: Readonly<Record<string, unknown>> | undefined,
  next: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return JSON.stringify(prior ?? {}) !== JSON.stringify(next ?? {});
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
    return isSearchable(newField.typeParams) ? [buildAddOp(tableName, fieldName)] : [];
  }

  if (event === 'dropped') {
    if (priorField === undefined) return [];
    return isSearchable(priorField.typeParams) ? [buildRemoveOp(tableName, fieldName)] : [];
  }

  if (priorField === undefined || newField === undefined) return [];
  const priorSearchable = isSearchable(priorField.typeParams);
  const newSearchable = isSearchable(newField.typeParams);

  if (priorSearchable && newSearchable) {
    return paramsDiffer(priorField.typeParams, newField.typeParams)
      ? [buildRotateOp(tableName, fieldName)]
      : [];
  }
  if (newSearchable) return [buildAddOp(tableName, fieldName)];
  if (priorSearchable) return [buildRemoveOp(tableName, fieldName)];
  return [];
}

export const cipherstashStringCodecHooks: CodecControlHooks = { onFieldEvent };

/** Re-export the codec id alongside the hooks so wiring sites import them together. */
export { CIPHERSTASH_STRING_CODEC_ID };
