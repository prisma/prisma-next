import { Contract, NormalizedContract, ChangeDetectionResult, UnsupportedChange } from './types';
import { columnSetsEqual } from './naming';

/**
 * Normalize contract for comparison (handle empty case)
 */
export function normalizeContract(contract: Contract | { kind: 'empty' }): NormalizedContract {
  if ('kind' in contract && contract.kind === 'empty') {
    return { tables: {} };
  }

  return {
    tables: contract.tables || {},
  };
}

/**
 * Detect all changes between two contracts
 */
export function detectChanges(
  contractA: Contract | { kind: 'empty' },
  contractB: Contract,
): ChangeDetectionResult {
  const normalizedA = normalizeContract(contractA);
  const normalizedB = normalizeContract(contractB);

  const unsupportedChanges = detectUnsupportedChanges(normalizedA, normalizedB);

  // If there are unsupported changes, throw immediately
  if (unsupportedChanges.length > 0) {
    throw new Error(formatUnsupportedChangesError(unsupportedChanges));
  }

  return {
    unsupportedChanges: [],
    addedTables: detectAddedTables(normalizedA, normalizedB),
    addedColumns: detectAddedColumns(normalizedA, normalizedB),
    addedUniques: detectAddedUniques(normalizedA, normalizedB),
    addedIndexes: detectAddedIndexes(normalizedA, normalizedB),
    addedForeignKeys: detectAddedForeignKeys(normalizedA, normalizedB),
  };
}

/**
 * Detect unsupported changes (renames, drops, type changes)
 */
function detectUnsupportedChanges(
  contractA: NormalizedContract,
  contractB: NormalizedContract,
): UnsupportedChange[] {
  const changes: UnsupportedChange[] = [];

  // Check for table renames/drops
  const tablesA = Object.keys(contractA.tables);
  const tablesB = Object.keys(contractB.tables);

  for (const tableA of tablesA) {
    if (!tablesB.includes(tableA)) {
      // Table removed - check if it's a rename
      const possibleRenames = tablesB.filter((tableB) => !tablesA.includes(tableB));
      if (possibleRenames.length === 1) {
        changes.push({
          kind: 'rename',
          type: 'table',
          old: tableA,
          new: possibleRenames[0],
        });
      } else {
        changes.push({
          kind: 'drop',
          type: 'table',
          name: tableA,
        });
      }
    }
  }

  // Check for column changes in existing tables
  for (const tableName of tablesA) {
    if (!tablesB.includes(tableName)) continue;

    const tableA = contractA.tables[tableName];
    const tableB = contractB.tables[tableName];

    const columnsA = Object.keys(tableA.columns || {});
    const columnsB = Object.keys(tableB.columns || {});

    // Check for column drops/renames
    for (const columnA of columnsA) {
      if (!columnsB.includes(columnA)) {
        // Column removed - check if it's a rename
        const possibleRenames = columnsB.filter((colB) => !columnsA.includes(colB));
        if (possibleRenames.length === 1) {
          changes.push({
            kind: 'rename',
            type: 'column',
            old: columnA,
            new: possibleRenames[0],
            table: tableName,
          });
        } else {
          changes.push({
            kind: 'drop',
            type: 'column',
            name: columnA,
            table: tableName,
          });
        }
      }
    }

    // Check for type changes in existing columns
    for (const columnName of columnsA) {
      if (!columnsB.includes(columnName)) continue;

      const columnA = tableA.columns[columnName];
      const columnB = tableB.columns[columnName];

      if (columnA.type !== columnB.type) {
        changes.push({
          kind: 'typeChange',
          table: tableName,
          column: columnName,
          oldType: columnA.type,
          newType: columnB.type,
        });
      }
    }
  }

  return changes;
}

/**
 * Detect added tables
 */
function detectAddedTables(contractA: NormalizedContract, contractB: NormalizedContract): string[] {
  const tablesA = Object.keys(contractA.tables);
  const tablesB = Object.keys(contractB.tables);

  return tablesB.filter((table) => !tablesA.includes(table));
}

/**
 * Detect added columns
 */
function detectAddedColumns(
  contractA: NormalizedContract,
  contractB: NormalizedContract,
): Array<{ table: string; column: string }> {
  const added: Array<{ table: string; column: string }> = [];

  for (const tableName of Object.keys(contractB.tables)) {
    const tableA = contractA.tables[tableName];
    const tableB = contractB.tables[tableName];

    if (!tableA) continue; // New table, handled separately

    const columnsA = Object.keys(tableA.columns || {});
    const columnsB = Object.keys(tableB.columns || {});

    for (const columnName of columnsB) {
      if (!columnsA.includes(columnName)) {
        // Check NOT NULL without default rule
        const columnB = tableB.columns[columnName];
        if (!columnB.nullable && !columnB.default) {
          throw new Error(
            `Column '${tableName}.${columnName}' added as NOT NULL without default. Make it nullable or add a default.`,
          );
        }

        added.push({ table: tableName, column: columnName });
      }
    }
  }

  return added;
}

/**
 * Detect added unique constraints
 */
function detectAddedUniques(
  contractA: NormalizedContract,
  contractB: NormalizedContract,
): Array<{ table: string; columns: string[] }> {
  const added: Array<{ table: string; columns: string[] }> = [];

  for (const tableName of Object.keys(contractB.tables)) {
    const tableA = contractA.tables[tableName];
    const tableB = contractB.tables[tableName];

    if (!tableA) continue; // New table, handled separately

    const uniquesA = tableA.uniques || [];
    const uniquesB = tableB.uniques || [];

    for (const uniqueB of uniquesB) {
      const exists = uniquesA.some((uniqueA) => columnSetsEqual(uniqueA.columns, uniqueB.columns));

      if (!exists) {
        added.push({ table: tableName, columns: uniqueB.columns });
      }
    }
  }

  return added;
}

/**
 * Detect added indexes
 */
function detectAddedIndexes(
  contractA: NormalizedContract,
  contractB: NormalizedContract,
): Array<{ table: string; columns: string[] }> {
  const added: Array<{ table: string; columns: string[] }> = [];

  for (const tableName of Object.keys(contractB.tables)) {
    const tableA = contractA.tables[tableName];
    const tableB = contractB.tables[tableName];

    if (!tableA) continue; // New table, handled separately

    const indexesA = tableA.indexes || [];
    const indexesB = tableB.indexes || [];

    for (const indexB of indexesB) {
      const exists = indexesA.some(
        (indexA) =>
          columnSetsEqual(indexA.columns, indexB.columns) &&
          (indexA.method || 'btree') === (indexB.method || 'btree'),
      );

      if (!exists) {
        added.push({ table: tableName, columns: indexB.columns });
      }
    }
  }

  return added;
}

/**
 * Detect added foreign keys
 */
function detectAddedForeignKeys(
  contractA: NormalizedContract,
  contractB: NormalizedContract,
): Array<{ table: string; columns: string[]; ref: { table: string; columns: string[] } }> {
  const added: Array<{
    table: string;
    columns: string[];
    ref: { table: string; columns: string[] };
  }> = [];

  for (const tableName of Object.keys(contractB.tables)) {
    const tableA = contractA.tables[tableName];
    const tableB = contractB.tables[tableName];

    if (!tableA) continue; // New table, handled separately

    const fksA = tableA.foreignKeys || [];
    const fksB = tableB.foreignKeys || [];

    for (const fkB of fksB) {
      const exists = fksA.some(
        (fkA) =>
          columnSetsEqual(fkA.columns, fkB.columns) &&
          fkA.references.table === fkB.references.table &&
          columnSetsEqual(fkA.references.columns, fkB.references.columns),
      );

      if (!exists) {
        added.push({
          table: tableName,
          columns: fkB.columns,
          ref: fkB.references,
        });
      }
    }
  }

  return added;
}

/**
 * Format unsupported changes error message
 */
function formatUnsupportedChangesError(changes: UnsupportedChange[]): string {
  const messages = changes.map((change) => {
    switch (change.kind) {
      case 'rename':
        if (change.type === 'table') {
          return `Table '${change.old}' removed and '${change.new}' added. Renames not supported in MVP.`;
        } else {
          return `Column '${change.table}.${change.old}' removed and '${change.table}.${change.new}' added. Renames not supported in MVP.`;
        }
      case 'drop':
        if (change.type === 'table') {
          return `Table '${change.name}' present in A but absent in B. Drops not supported in MVP.`;
        } else {
          return `Column '${change.table}.${change.name}' present in A but absent in B. Drops not supported in MVP.`;
        }
      case 'typeChange':
        return `Column '${change.table}.${change.column}' changed type from ${change.oldType} to ${change.newType}. Type changes not supported in MVP.`;
      case 'notNullWithoutDefault':
        return `Column '${change.table}.${change.column}' added as NOT NULL without default. Make it nullable or add a default.`;
    }
  });

  return messages.join('\n');
}
