/**
 * Contract-to-contract planner.
 *
 * Diffs two SQL contracts (or null → contract for new projects) and produces
 * an ordered list of SQL migration operations via the injected SqlEmitter.
 * No database connection needed — this is a pure, deterministic function over
 * contract artifacts.
 *
 * The planner enforces additive-only policy for MVP: any non-additive change
 * (column removal, type narrowing, nullability tightening) is reported as a
 * conflict and no ops are produced.
 */

import type {
  ContractDiffConflict,
  ContractDiffResult,
  MigrationPlanOperation,
} from '@prisma-next/core-control-plane/types';
import type { ForeignKey, SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import type { SqlEmitter } from './sql-emitter';

// ============================================================================
// Public API
// ============================================================================

/**
 * Options for the contract-to-contract planner.
 */
export interface ContractPlannerOptions {
  readonly from: SqlStorage | null;
  readonly to: SqlStorage;
  readonly emitter: SqlEmitter;
}

/**
 * Diff two SQL storage states and produce SQL migration operations.
 *
 * Returns a success result with ordered operations, or a failure result
 * with conflicts if non-additive changes are detected.
 */
export function planContractDiff(options: ContractPlannerOptions): ContractDiffResult {
  const from = options.from ?? EMPTY_STORAGE;
  const to = options.to;
  const { emitter } = options;

  const conflicts = detectConflicts(from, to);
  if (conflicts.length > 0) {
    return { kind: 'failure', conflicts };
  }

  const ops: MigrationPlanOperation[] = [];

  // Deterministic ordering:
  // 1. enableExtension (database dependencies)
  // 2. createStorageType (custom types)
  // 3. createTable (new tables with columns + inline PK)
  // 4. addColumn (new columns in existing tables)
  // 5. addPrimaryKey (PKs on existing tables that didn't have one)
  // 6. addUniqueConstraint
  // 7. createIndex
  // 8. addForeignKey
  ops.push(...planExtensionOps(from, to, emitter));
  ops.push(...planStorageTypeOps(from, to, emitter));
  ops.push(...planTableOps(from, to, emitter));
  ops.push(...planColumnOps(from, to, emitter));
  ops.push(...planPrimaryKeyOps(from, to, emitter));
  ops.push(...planUniqueConstraintOps(from, to, emitter));
  ops.push(...planIndexOps(from, to, emitter));
  ops.push(...planForeignKeyOps(from, to, emitter));

  return { kind: 'success', ops };
}

// ============================================================================
// Empty storage sentinel
// ============================================================================

const EMPTY_STORAGE: SqlStorage = { tables: {} };

// ============================================================================
// Conflict detection
// ============================================================================

function detectConflicts(from: SqlStorage, to: SqlStorage): ContractDiffConflict[] {
  const conflicts: ContractDiffConflict[] = [];

  for (const tableName of sortedKeys(from.tables)) {
    if (!(tableName in to.tables)) {
      conflicts.push({
        kind: 'tableRemoved',
        summary: `Table "${tableName}" was removed`,
        location: { table: tableName },
      });
    }
  }

  for (const [tableName, fromTable] of sortedEntries(from.tables)) {
    const toTable = to.tables[tableName];
    if (!toTable) continue;

    for (const [columnName, fromCol] of sortedEntries(fromTable.columns)) {
      const toCol = toTable.columns[columnName];
      if (!toCol) {
        conflicts.push({
          kind: 'columnRemoved',
          summary: `Column "${tableName}"."${columnName}" was removed`,
          location: { table: tableName, column: columnName },
        });
        continue;
      }

      if (fromCol.nativeType !== toCol.nativeType) {
        conflicts.push({
          kind: 'typeMismatch',
          summary: `Column "${tableName}"."${columnName}" type changed from "${fromCol.nativeType}" to "${toCol.nativeType}"`,
          location: { table: tableName, column: columnName },
        });
      }

      if (fromCol.nullable && !toCol.nullable) {
        conflicts.push({
          kind: 'nullabilityConflict',
          summary: `Column "${tableName}"."${columnName}" changed from nullable to non-nullable`,
          location: { table: tableName, column: columnName },
        });
      }
    }

    if (fromTable.primaryKey && toTable.primaryKey) {
      if (!arraysEqual(fromTable.primaryKey.columns, toTable.primaryKey.columns)) {
        conflicts.push({
          kind: 'primaryKeyChanged',
          summary: `Primary key on "${tableName}" changed columns`,
          location: { table: tableName },
        });
      }
    }

    if (fromTable.primaryKey && !toTable.primaryKey) {
      conflicts.push({
        kind: 'primaryKeyChanged',
        summary: `Primary key on "${tableName}" was removed`,
        location: { table: tableName },
      });
    }
  }

  const fromTypes = from.types ?? {};
  const toTypes = to.types ?? {};
  for (const typeName of sortedKeys(fromTypes)) {
    if (!(typeName in toTypes)) {
      conflicts.push({
        kind: 'unsupportedChange',
        summary: `Storage type "${typeName}" was removed`,
      });
    }
  }

  return conflicts.sort(conflictComparator);
}

// ============================================================================
// Extension ops
// ============================================================================

/**
 * Detect extensions needed in `to` that aren't in `from`.
 *
 * NOTE: In the MVP, extension detection is best-effort. The codec→extension
 * mapping is hard-coded for known cases (pgvector). A future iteration may
 * embed extension requirements directly in the contract.
 */
function planExtensionOps(
  from: SqlStorage,
  to: SqlStorage,
  emitter: SqlEmitter,
): MigrationPlanOperation[] {
  const fromExtensions = collectExtensions(from);
  const toExtensions = collectExtensions(to);
  const ops: MigrationPlanOperation[] = [];

  for (const [extension, dependencyId] of sortedEntries(toExtensions)) {
    if (extension in fromExtensions) continue;
    ops.push(emitter.emitEnableExtension({ extension, dependencyId }));
  }

  return ops;
}

const CODEC_EXTENSION_MAP: Record<string, string> = {
  'pg/vector@1': 'vector',
};

function collectExtensions(storage: SqlStorage): Record<string, string> {
  const extensions: Record<string, string> = {};
  for (const [, typeInstance] of sortedEntries(storage.types ?? {})) {
    const ext = CODEC_EXTENSION_MAP[typeInstance.codecId];
    if (ext) {
      extensions[ext] = typeInstance.codecId;
    }
  }
  return extensions;
}

// ============================================================================
// Storage type ops
// ============================================================================

function planStorageTypeOps(
  from: SqlStorage,
  to: SqlStorage,
  emitter: SqlEmitter,
): MigrationPlanOperation[] {
  const fromTypes = from.types ?? {};
  const toTypes = to.types ?? {};
  const ops: MigrationPlanOperation[] = [];

  for (const [typeName, typeInstance] of sortedEntries(toTypes)) {
    if (typeName in fromTypes) continue;
    ops.push(emitter.emitCreateStorageType({ typeName, typeInstance }));
  }

  return ops;
}

// ============================================================================
// Table ops
// ============================================================================

function planTableOps(
  from: SqlStorage,
  to: SqlStorage,
  emitter: SqlEmitter,
): MigrationPlanOperation[] {
  const ops: MigrationPlanOperation[] = [];

  for (const [tableName, toTable] of sortedEntries(to.tables)) {
    if (tableName in from.tables) continue;
    ops.push(emitter.emitCreateTable({ tableName, table: toTable }));
  }

  return ops;
}

// ============================================================================
// Column ops (addColumn for existing tables)
// ============================================================================

function planColumnOps(
  from: SqlStorage,
  to: SqlStorage,
  emitter: SqlEmitter,
): MigrationPlanOperation[] {
  const ops: MigrationPlanOperation[] = [];

  for (const [tableName, toTable] of sortedEntries(to.tables)) {
    const fromTable = from.tables[tableName];
    if (!fromTable) continue;

    for (const [columnName, toCol] of sortedEntries(toTable.columns)) {
      if (columnName in fromTable.columns) continue;
      ops.push(emitter.emitAddColumn({ tableName, columnName, column: toCol }));
    }
  }

  return ops;
}

// ============================================================================
// Primary key ops (on existing tables)
// ============================================================================

function planPrimaryKeyOps(
  from: SqlStorage,
  to: SqlStorage,
  emitter: SqlEmitter,
): MigrationPlanOperation[] {
  const ops: MigrationPlanOperation[] = [];

  for (const [tableName, toTable] of sortedEntries(to.tables)) {
    if (!toTable.primaryKey) continue;

    const fromTable = from.tables[tableName];
    if (!fromTable) continue;
    if (fromTable.primaryKey) continue;

    const constraintName = toTable.primaryKey.name ?? `${tableName}_pkey`;
    ops.push(
      emitter.emitAddPrimaryKey({
        tableName,
        constraintName,
        columns: [...toTable.primaryKey.columns],
      }),
    );
  }

  return ops;
}

// ============================================================================
// Unique constraint ops
// ============================================================================

function planUniqueConstraintOps(
  from: SqlStorage,
  to: SqlStorage,
  emitter: SqlEmitter,
): MigrationPlanOperation[] {
  const ops: MigrationPlanOperation[] = [];

  for (const [tableName, toTable] of sortedEntries(to.tables)) {
    const fromTable = from.tables[tableName];

    for (const unique of toTable.uniques) {
      if (fromTable && isUniqueConstraintSatisfied(fromTable, unique.columns)) continue;

      const constraintName = unique.name ?? `${tableName}_${unique.columns.join('_')}_key`;
      ops.push(
        emitter.emitAddUniqueConstraint({
          tableName,
          constraintName,
          columns: [...unique.columns],
        }),
      );
    }
  }

  return ops;
}

// ============================================================================
// Index ops
// ============================================================================

function planIndexOps(
  from: SqlStorage,
  to: SqlStorage,
  emitter: SqlEmitter,
): MigrationPlanOperation[] {
  const ops: MigrationPlanOperation[] = [];

  for (const [tableName, toTable] of sortedEntries(to.tables)) {
    const fromTable = from.tables[tableName];

    for (const index of toTable.indexes) {
      if (fromTable && isIndexSatisfied(fromTable, index.columns)) continue;

      const indexName = index.name ?? `${tableName}_${index.columns.join('_')}_idx`;
      ops.push(emitter.emitCreateIndex({ tableName, indexName, columns: [...index.columns] }));
    }
  }

  return ops;
}

// ============================================================================
// Foreign key ops
// ============================================================================

function planForeignKeyOps(
  from: SqlStorage,
  to: SqlStorage,
  emitter: SqlEmitter,
): MigrationPlanOperation[] {
  const ops: MigrationPlanOperation[] = [];

  for (const [tableName, toTable] of sortedEntries(to.tables)) {
    const fromTable = from.tables[tableName];

    for (const fk of toTable.foreignKeys) {
      if (fromTable && hasForeignKey(fromTable, fk)) continue;

      const constraintName = fk.name ?? `${tableName}_${fk.columns.join('_')}_fkey`;
      ops.push(emitter.emitAddForeignKey({ tableName, constraintName, foreignKey: fk }));
    }
  }

  return ops;
}

// ============================================================================
// Satisfaction predicates
// ============================================================================

function isUniqueConstraintSatisfied(table: StorageTable, columns: readonly string[]): boolean {
  for (const u of table.uniques) {
    if (arraysEqual(u.columns, columns)) return true;
  }
  for (const idx of table.indexes) {
    if (arraysEqual(idx.columns, columns)) return true;
  }
  return false;
}

function isIndexSatisfied(table: StorageTable, columns: readonly string[]): boolean {
  for (const idx of table.indexes) {
    if (arraysEqual(idx.columns, columns)) return true;
  }
  for (const u of table.uniques) {
    if (arraysEqual(u.columns, columns)) return true;
  }
  return false;
}

function hasForeignKey(table: StorageTable, fk: ForeignKey): boolean {
  return table.foreignKeys.some(
    (candidate) =>
      arraysEqual(candidate.columns, fk.columns) &&
      candidate.references.table === fk.references.table &&
      arraysEqual(candidate.references.columns, fk.references.columns),
  );
}

// ============================================================================
// Utility functions
// ============================================================================

function sortedEntries<V>(record: Readonly<Record<string, V>>): Array<[string, V]> {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b)) as Array<[string, V]>;
}

function sortedKeys(record: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(record).sort((a, b) => a.localeCompare(b));
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function conflictComparator(a: ContractDiffConflict, b: ContractDiffConflict): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  const aTable = a.location?.table ?? '';
  const bTable = b.location?.table ?? '';
  if (aTable !== bTable) return aTable < bTable ? -1 : 1;
  const aCol = a.location?.column ?? '';
  const bCol = b.location?.column ?? '';
  if (aCol !== bCol) return aCol < bCol ? -1 : 1;
  return a.summary < b.summary ? -1 : a.summary > b.summary ? 1 : 0;
}
