/**
 * Contract-to-contract planner.
 *
 * Diffs two SQL contracts (or null → contract for new projects) and produces
 * an ordered list of abstract migration operations. No database connection
 * needed — this is a pure, deterministic function over contract artifacts.
 *
 * The planner enforces additive-only policy for MVP: any non-additive change
 * (column removal, type narrowing, nullability tightening) is reported as a
 * conflict and no ops are produced.
 */

import type { ColumnDefault } from '@prisma-next/contract/types';
import type {
  AbstractCheck,
  AbstractColumnDefault,
  AbstractColumnDefinition,
  AbstractOp,
  AddColumnOp,
  AddForeignKeyOp,
  AddPrimaryKeyOp,
  AddUniqueConstraintOp,
  ContractDiffConflict,
  ContractDiffResult,
  CreateIndexOp,
  CreateStorageTypeOp,
  CreateTableOp,
  EnableExtensionOp,
} from '@prisma-next/core-control-plane/abstract-ops';
import type {
  ForeignKey,
  SqlStorage,
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';

// ============================================================================
// Public API
// ============================================================================

/**
 * Options for the contract-to-contract planner.
 */
export interface ContractPlannerOptions {
  /**
   * The "from" storage state. `null` means empty (new project).
   */
  readonly from: SqlStorage | null;
  /**
   * The "to" storage state (the desired state).
   */
  readonly to: SqlStorage;
}

/**
 * Diff two SQL storage states and produce abstract migration operations.
 *
 * Returns a success result with ordered abstract ops, or a failure result
 * with conflicts if non-additive changes are detected.
 */
export function planContractDiff(options: ContractPlannerOptions): ContractDiffResult {
  const from = options.from ?? EMPTY_STORAGE;
  const to = options.to;

  // Detect non-additive conflicts first
  const conflicts = detectConflicts(from, to);
  if (conflicts.length > 0) {
    return { kind: 'failure', conflicts };
  }

  const ops: AbstractOp[] = [];

  // Deterministic ordering follows the existing Postgres planner:
  // 1. enableExtension (database dependencies)
  // 2. createStorageType (custom types)
  // 3. createTable (new tables with columns + inline PK)
  // 4. addColumn (new columns in existing tables)
  // 5. addPrimaryKey (PKs on existing tables that didn't have one)
  // 6. addUniqueConstraint
  // 7. createIndex
  // 8. addForeignKey
  ops.push(...planExtensionOps(from, to));
  ops.push(...planStorageTypeOps(from, to));
  ops.push(...planTableOps(from, to));
  ops.push(...planColumnOps(from, to));
  ops.push(...planPrimaryKeyOps(from, to));
  ops.push(...planUniqueConstraintOps(from, to));
  ops.push(...planIndexOps(from, to));
  ops.push(...planForeignKeyOps(from, to));

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

  // Tables removed
  for (const tableName of sortedKeys(from.tables)) {
    if (!(tableName in to.tables)) {
      conflicts.push({
        kind: 'tableRemoved',
        summary: `Table "${tableName}" was removed`,
        location: { table: tableName },
      });
    }
  }

  // Per-table: column removals and type/nullability changes
  for (const [tableName, fromTable] of sortedEntries(from.tables)) {
    const toTable = to.tables[tableName];
    if (!toTable) continue; // already reported as tableRemoved

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

      // Type change
      if (fromCol.nativeType !== toCol.nativeType) {
        conflicts.push({
          kind: 'typeMismatch',
          summary: `Column "${tableName}"."${columnName}" type changed from "${fromCol.nativeType}" to "${toCol.nativeType}"`,
          location: { table: tableName, column: columnName },
        });
      }

      // Nullability tightening (nullable → not nullable)
      if (fromCol.nullable && !toCol.nullable) {
        conflicts.push({
          kind: 'nullabilityConflict',
          summary: `Column "${tableName}"."${columnName}" changed from nullable to non-nullable`,
          location: { table: tableName, column: columnName },
        });
      }
    }

    // Primary key changed (existed before, different now)
    if (fromTable.primaryKey && toTable.primaryKey) {
      if (!arraysEqual(fromTable.primaryKey.columns, toTable.primaryKey.columns)) {
        conflicts.push({
          kind: 'primaryKeyChanged',
          summary: `Primary key on "${tableName}" changed columns`,
          location: { table: tableName },
        });
      }
    }

    // Primary key removed
    if (fromTable.primaryKey && !toTable.primaryKey) {
      conflicts.push({
        kind: 'primaryKeyChanged',
        summary: `Primary key on "${tableName}" was removed`,
        location: { table: tableName },
      });
    }
  }

  // Storage types removed
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
 * Extensions are inferred from storage types that reference codecs with
 * known extension mappings. Since we're working at the contract level
 * (not with framework components), we detect extensions by comparing
 * the set of storage type codec IDs between from/to and looking for
 * typeRef columns that reference types needing extensions.
 *
 * NOTE: In the MVP, extension detection is best-effort. The codec→extension
 * mapping is hard-coded for known cases (pgvector). A future iteration may
 * embed extension requirements directly in the contract.
 */
function planExtensionOps(from: SqlStorage, to: SqlStorage): EnableExtensionOp[] {
  const fromExtensions = collectExtensions(from);
  const toExtensions = collectExtensions(to);
  const ops: EnableExtensionOp[] = [];

  for (const [extension, dependencyId] of sortedEntries(toExtensions)) {
    if (extension in fromExtensions) continue;

    ops.push({
      op: 'enableExtension',
      id: `extension.${extension}`,
      label: `Enable extension ${extension}`,
      operationClass: 'additive',
      pre: [{ id: 'extensionNotInstalled', params: { extension } }],
      post: [{ id: 'extensionInstalled', params: { extension } }],
      args: { extension, dependencyId },
    });
  }

  return ops;
}

/**
 * Known codec→extension mappings.
 * In the future this should come from the contract or extension pack metadata.
 */
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

function planStorageTypeOps(from: SqlStorage, to: SqlStorage): CreateStorageTypeOp[] {
  const fromTypes = from.types ?? {};
  const toTypes = to.types ?? {};
  const ops: CreateStorageTypeOp[] = [];

  for (const [typeName, typeInstance] of sortedEntries(toTypes)) {
    if (typeName in fromTypes) continue;

    ops.push(buildCreateStorageTypeOp(typeName, typeInstance));
  }

  return ops;
}

function buildCreateStorageTypeOp(
  typeName: string,
  typeInstance: StorageTypeInstance,
): CreateStorageTypeOp {
  return {
    op: 'createStorageType',
    id: `storageType.${typeName}`,
    label: `Create storage type ${typeName}`,
    operationClass: 'additive',
    pre: [],
    post: [],
    args: {
      typeName,
      codecId: typeInstance.codecId,
      nativeType: typeInstance.nativeType,
      typeParams: typeInstance.typeParams,
    },
  };
}

// ============================================================================
// Table ops
// ============================================================================

function planTableOps(from: SqlStorage, to: SqlStorage): CreateTableOp[] {
  const ops: CreateTableOp[] = [];

  for (const [tableName, toTable] of sortedEntries(to.tables)) {
    if (tableName in from.tables) continue;

    ops.push(buildCreateTableOp(tableName, toTable));
  }

  return ops;
}

function buildCreateTableOp(tableName: string, table: StorageTable): CreateTableOp {
  const columns = sortedEntries(table.columns).map(([name, col]) => toAbstractColumn(name, col));

  const primaryKey = table.primaryKey
    ? {
        columns: [...table.primaryKey.columns],
        ...(table.primaryKey.name ? { name: table.primaryKey.name } : {}),
      }
    : undefined;

  const pre: AbstractCheck[] = [{ id: 'tableNotExists', params: { table: tableName } }];
  const post: AbstractCheck[] = [{ id: 'tableExists', params: { table: tableName } }];

  return {
    op: 'createTable',
    id: `table.${tableName}`,
    label: `Create table ${tableName}`,
    operationClass: 'additive',
    pre,
    post,
    args: {
      table: tableName,
      columns,
      ...(primaryKey ? { primaryKey } : {}),
    },
  };
}

// ============================================================================
// Column ops (addColumn for existing tables)
// ============================================================================

function planColumnOps(from: SqlStorage, to: SqlStorage): AddColumnOp[] {
  const ops: AddColumnOp[] = [];

  for (const [tableName, toTable] of sortedEntries(to.tables)) {
    const fromTable = from.tables[tableName];
    if (!fromTable) continue; // new table, handled by createTable

    for (const [columnName, toCol] of sortedEntries(toTable.columns)) {
      if (columnName in fromTable.columns) continue;

      ops.push(buildAddColumnOp(tableName, columnName, toCol));
    }
  }

  return ops;
}

function buildAddColumnOp(
  tableName: string,
  columnName: string,
  column: StorageColumn,
): AddColumnOp {
  const notNull = !column.nullable;
  const hasDefault = column.default !== undefined;
  const requiresEmptyTable = notNull && !hasDefault;

  const pre: AbstractCheck[] = [
    { id: 'columnNotExists', params: { table: tableName, column: columnName } },
  ];
  if (requiresEmptyTable) {
    pre.push({ id: 'tableIsEmpty', params: { table: tableName } });
  }

  const post: AbstractCheck[] = [
    { id: 'columnExists', params: { table: tableName, column: columnName } },
  ];
  if (notNull) {
    post.push({ id: 'columnIsNotNull', params: { table: tableName, column: columnName } });
  }

  return {
    op: 'addColumn',
    id: `column.${tableName}.${columnName}`,
    label: `Add column ${columnName} to ${tableName}`,
    operationClass: 'additive',
    pre,
    post,
    args: {
      table: tableName,
      column: toAbstractColumn(columnName, column),
    },
  };
}

// ============================================================================
// Primary key ops (on existing tables)
// ============================================================================

function planPrimaryKeyOps(from: SqlStorage, to: SqlStorage): AddPrimaryKeyOp[] {
  const ops: AddPrimaryKeyOp[] = [];

  for (const [tableName, toTable] of sortedEntries(to.tables)) {
    if (!toTable.primaryKey) continue;

    const fromTable = from.tables[tableName];
    if (!fromTable) continue; // new table, PK handled inline by createTable
    if (fromTable.primaryKey) continue; // PK already exists (conflicts already checked)

    const constraintName = toTable.primaryKey.name ?? `${tableName}_pkey`;

    ops.push({
      op: 'addPrimaryKey',
      id: `primaryKey.${tableName}.${constraintName}`,
      label: `Add primary key ${constraintName} on ${tableName}`,
      operationClass: 'additive',
      pre: [{ id: 'primaryKeyNotExists', params: { table: tableName } }],
      post: [{ id: 'primaryKeyExists', params: { table: tableName, name: constraintName } }],
      args: {
        table: tableName,
        constraintName,
        columns: [...toTable.primaryKey.columns],
      },
    });
  }

  return ops;
}

// ============================================================================
// Unique constraint ops
// ============================================================================

function planUniqueConstraintOps(from: SqlStorage, to: SqlStorage): AddUniqueConstraintOp[] {
  const ops: AddUniqueConstraintOp[] = [];

  for (const [tableName, toTable] of sortedEntries(to.tables)) {
    const fromTable = from.tables[tableName];

    for (const unique of toTable.uniques) {
      if (fromTable && isUniqueConstraintSatisfied(fromTable, unique.columns)) continue;

      const constraintName = unique.name ?? `${tableName}_${unique.columns.join('_')}_key`;

      ops.push({
        op: 'addUniqueConstraint',
        id: `unique.${tableName}.${constraintName}`,
        label: `Add unique constraint ${constraintName} on ${tableName}`,
        operationClass: 'additive',
        pre: [{ id: 'constraintNotExists', params: { table: tableName, name: constraintName } }],
        post: [{ id: 'constraintExists', params: { table: tableName, name: constraintName } }],
        args: {
          table: tableName,
          constraintName,
          columns: [...unique.columns],
        },
      });
    }
  }

  return ops;
}

// ============================================================================
// Index ops
// ============================================================================

function planIndexOps(from: SqlStorage, to: SqlStorage): CreateIndexOp[] {
  const ops: CreateIndexOp[] = [];

  for (const [tableName, toTable] of sortedEntries(to.tables)) {
    const fromTable = from.tables[tableName];

    for (const index of toTable.indexes) {
      if (fromTable && isIndexSatisfied(fromTable, index.columns)) continue;

      const indexName = index.name ?? `${tableName}_${index.columns.join('_')}_idx`;

      ops.push({
        op: 'createIndex',
        id: `index.${tableName}.${indexName}`,
        label: `Create index ${indexName} on ${tableName}`,
        operationClass: 'additive',
        pre: [{ id: 'indexNotExists', params: { table: tableName, name: indexName } }],
        post: [{ id: 'indexExists', params: { table: tableName, name: indexName } }],
        args: {
          table: tableName,
          indexName,
          columns: [...index.columns],
        },
      });
    }
  }

  return ops;
}

// ============================================================================
// Foreign key ops
// ============================================================================

function planForeignKeyOps(from: SqlStorage, to: SqlStorage): AddForeignKeyOp[] {
  const ops: AddForeignKeyOp[] = [];

  for (const [tableName, toTable] of sortedEntries(to.tables)) {
    const fromTable = from.tables[tableName];

    for (const fk of toTable.foreignKeys) {
      if (fromTable && hasForeignKey(fromTable, fk)) continue;

      const constraintName = fk.name ?? `${tableName}_${fk.columns.join('_')}_fkey`;

      ops.push({
        op: 'addForeignKey',
        id: `foreignKey.${tableName}.${constraintName}`,
        label: `Add foreign key ${constraintName} on ${tableName}`,
        operationClass: 'additive',
        pre: [{ id: 'constraintNotExists', params: { table: tableName, name: constraintName } }],
        post: [{ id: 'constraintExists', params: { table: tableName, name: constraintName } }],
        args: {
          table: tableName,
          constraintName,
          columns: [...fk.columns],
          referencedTable: fk.references.table,
          referencedColumns: [...fk.references.columns],
        },
      });
    }
  }

  return ops;
}

// ============================================================================
// Column helpers
// ============================================================================

function toAbstractColumn(name: string, col: StorageColumn): AbstractColumnDefinition {
  const result: AbstractColumnDefinition = {
    name,
    nativeType: col.nativeType,
    codecId: col.codecId,
    nullable: col.nullable,
    ...(col.default ? { default: toAbstractDefault(col.default) } : {}),
    ...(col.typeParams ? { typeParams: col.typeParams } : {}),
    ...(col.typeRef ? { typeRef: col.typeRef } : {}),
  };
  return result;
}

function toAbstractDefault(def: ColumnDefault): AbstractColumnDefault {
  switch (def.kind) {
    case 'literal':
      return { kind: 'literal', expression: def.expression };
    case 'function':
      return { kind: 'function', expression: def.expression };
  }
}

// ============================================================================
// Satisfaction predicates (mirror the existing planner's approach)
// ============================================================================

/**
 * A unique constraint is "satisfied" if the from table already has a unique
 * constraint or unique index covering exactly the same column set.
 */
function isUniqueConstraintSatisfied(table: StorageTable, columns: readonly string[]): boolean {
  // Check uniques
  for (const u of table.uniques) {
    if (arraysEqual(u.columns, columns)) return true;
  }
  // A unique index on exactly these columns also satisfies
  for (const idx of table.indexes) {
    if (arraysEqual(idx.columns, columns)) return true;
  }
  return false;
}

/**
 * An index is "satisfied" if the from table already has an index covering
 * exactly the same column set, or a unique constraint on those columns.
 */
function isIndexSatisfied(table: StorageTable, columns: readonly string[]): boolean {
  for (const idx of table.indexes) {
    if (arraysEqual(idx.columns, columns)) return true;
  }
  for (const u of table.uniques) {
    if (arraysEqual(u.columns, columns)) return true;
  }
  return false;
}

/**
 * A foreign key is "satisfied" if the from table already has a foreign key
 * with the same columns, referenced table, and referenced columns.
 */
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
