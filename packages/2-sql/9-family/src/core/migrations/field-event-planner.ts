/**
 * Codec lifecycle hook planner — runs `onFieldEvent` for every per-field
 * delta between two contracts and concatenates the returned ops in a
 * deterministic order.
 *
 * Wired by each target's planner (`PostgresMigrationPlanner`,
 * `SqliteMigrationPlanner`) so codec-emitted ops are inlined alongside
 * structural DDL in the app-space migration's `ops.json`. Pure, target-
 * agnostic, and only ever invoked at the app-space emitter; extension-space
 * planning never reaches this helper.
 *
 * Ordering rules:
 *
 * - Events are grouped by phase: `'added'` → `'dropped'` → `'altered'`.
 * - Within each phase, entries are sorted alphabetically by
 *   `(tableName, fieldName)`.
 * - The hook's returned ops are appended in the order the hook returned them.
 *
 * `'altered'` is suppressed when only `codecId` differs (codec rotation is a
 * v1 non-goal).
 */

import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage, StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
import type {
  CodecControlHooks,
  FieldEvent,
  FieldEventContext,
  SqlMigrationPlanOperation,
} from './types';

export interface PlanFieldEventOperationsOptions {
  /**
   * Prior contract the planner is diffing against. `null` for first emits
   * (every field is treated as added).
   */
  readonly priorContract: Contract<SqlStorage> | null;
  /**
   * New contract the user just authored.
   */
  readonly newContract: Contract<SqlStorage>;
  /**
   * Codec-id keyed map of control hooks, as produced by
   * {@link import('./assembly').extractCodecControlHooks}. Hooks carry
   * `unknown` target details after extraction; the caller casts the
   * helper's returned ops to its target's `SqlMigrationPlanOperation`
   * specialisation at the integration boundary, mirroring how
   * `storageTypePlanCallStrategy` lifts `planTypeOperations` results into
   * `RawSqlCall`.
   */
  readonly codecHooks: ReadonlyMap<string, CodecControlHooks>;
}

interface FieldEntry {
  readonly tableName: string;
  readonly fieldName: string;
  readonly priorTable: StorageTable | undefined;
  readonly newTable: StorageTable | undefined;
  readonly priorField: StorageColumn | undefined;
  readonly newField: StorageColumn | undefined;
}

export function planFieldEventOperations(
  options: PlanFieldEventOperationsOptions,
): readonly SqlMigrationPlanOperation<unknown>[] {
  const priorTables = options.priorContract?.storage.tables ?? {};
  const newTables = options.newContract.storage.tables;

  const added: FieldEntry[] = [];
  const dropped: FieldEntry[] = [];
  const altered: FieldEntry[] = [];

  const tableNames = unionSorted(Object.keys(priorTables), Object.keys(newTables));
  for (const tableName of tableNames) {
    const priorTable = priorTables[tableName];
    const newTable = newTables[tableName];
    const fieldNames = unionSorted(
      priorTable ? Object.keys(priorTable.columns) : [],
      newTable ? Object.keys(newTable.columns) : [],
    );
    for (const fieldName of fieldNames) {
      const priorField = priorTable?.columns[fieldName];
      const newField = newTable?.columns[fieldName];
      const entry: FieldEntry = {
        tableName,
        fieldName,
        priorTable,
        newTable,
        priorField,
        newField,
      };
      if (priorField === undefined && newField !== undefined) {
        added.push(entry);
      } else if (priorField !== undefined && newField === undefined) {
        dropped.push(entry);
      } else if (priorField !== undefined && newField !== undefined) {
        if (isAlteration(priorField, newField)) altered.push(entry);
      }
    }
  }

  const ops: SqlMigrationPlanOperation<unknown>[] = [];
  appendOps('added', added, options.codecHooks, ops, (e) => e.newField?.codecId);
  appendOps('dropped', dropped, options.codecHooks, ops, (e) => e.priorField?.codecId);
  appendOps('altered', altered, options.codecHooks, ops, (e) => e.newField?.codecId);
  return ops;
}

function appendOps(
  event: FieldEvent,
  entries: readonly FieldEntry[],
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
  ops: SqlMigrationPlanOperation<unknown>[],
  pickCodecId: (entry: FieldEntry) => string | undefined,
): void {
  for (const entry of entries) {
    const codecId = pickCodecId(entry);
    if (codecId === undefined) continue;
    const hook = codecHooks.get(codecId);
    if (!hook?.onFieldEvent) continue;
    const ctx = buildContext(event, entry);
    const emitted = hook.onFieldEvent(event, ctx);
    for (const op of emitted) ops.push(op);
  }
}

/**
 * The context's prior/new sides are scoped to the event:
 *
 * - `'added'`   — only `newTable` / `newField` populated.
 * - `'dropped'` — only `priorTable` / `priorField` populated.
 * - `'altered'` — both sides populated.
 */
function buildContext(event: FieldEvent, entry: FieldEntry): FieldEventContext {
  const base = { tableName: entry.tableName, fieldName: entry.fieldName };
  if (event === 'added') {
    return {
      ...base,
      ...(entry.newTable !== undefined ? { newTable: entry.newTable } : {}),
      ...(entry.newField !== undefined ? { newField: entry.newField } : {}),
    };
  }
  if (event === 'dropped') {
    return {
      ...base,
      ...(entry.priorTable !== undefined ? { priorTable: entry.priorTable } : {}),
      ...(entry.priorField !== undefined ? { priorField: entry.priorField } : {}),
    };
  }
  return {
    ...base,
    ...(entry.priorTable !== undefined ? { priorTable: entry.priorTable } : {}),
    ...(entry.newTable !== undefined ? { newTable: entry.newTable } : {}),
    ...(entry.priorField !== undefined ? { priorField: entry.priorField } : {}),
    ...(entry.newField !== undefined ? { newField: entry.newField } : {}),
  };
}

/**
 * `'altered'` predicate: returns `true` when any property other than
 * `codecId` differs. Pure-`codecId` changes are excluded — codec rotation
 * is a v1 non-goal (project spec § Non-goals).
 */
function isAlteration(prior: StorageColumn, current: StorageColumn): boolean {
  if (prior.codecId !== current.codecId) return false;
  return !sameStorageColumn(prior, current);
}

function sameStorageColumn(a: StorageColumn, b: StorageColumn): boolean {
  if (a === b) return true;
  if (a.nativeType !== b.nativeType) return false;
  if (a.nullable !== b.nullable) return false;
  if (a.typeRef !== b.typeRef) return false;
  if (!sameJson(a.typeParams, b.typeParams)) return false;
  if (!sameJson(a.default, b.default)) return false;
  return true;
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function unionSorted(a: readonly string[], b: readonly string[]): readonly string[] {
  const set = new Set<string>();
  for (const name of a) set.add(name);
  for (const name of b) set.add(name);
  return [...set].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
}
