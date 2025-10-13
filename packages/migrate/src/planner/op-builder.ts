import {
  Op,
  AddTableOp,
  AddColumnOp,
  AddUniqueOp,
  AddIndexOp,
  AddForeignKeyOp,
} from '../lowering/postgres';
import { Contract, NormalizedContract } from './types';
import { generateConstraintName, columnSetsEqual } from './naming';

/**
 * Build operations for all detected changes
 */
export function buildOperations(
  contractA: Contract | { kind: 'empty' },
  contractB: Contract,
  changes: {
    addedTables: string[];
    addedColumns: Array<{ table: string; column: string }>;
    addedUniques: Array<{ table: string; columns: string[] }>;
    addedIndexes: Array<{ table: string; columns: string[] }>;
    addedForeignKeys: Array<{
      table: string;
      columns: string[];
      ref: { table: string; columns: string[] };
    }>;
  },
): Op[] {
  const normalizedA = normalizeContract(contractA);
  const normalizedB = normalizeContract(contractB);
  const operations: Op[] = [];

  // 1. Add tables first
  for (const tableName of changes.addedTables) {
    operations.push(buildAddTableOp(tableName, normalizedB.tables[tableName]));
  }

  // 2. Add columns to existing tables
  for (const { table, column } of changes.addedColumns) {
    operations.push(buildAddColumnOp(table, column, normalizedB.tables[table].columns[column]));
  }

  // 3. Add unique constraints
  for (const { table, columns } of changes.addedUniques) {
    operations.push(buildAddUniqueOp(table, columns));
  }

  // 4. Add indexes (including FK supporting indexes)
  const fkSupportingIndexes = buildFkSupportingIndexes(
    changes.addedForeignKeys,
    normalizedA,
    normalizedB,
  );
  const allIndexes = [...changes.addedIndexes, ...fkSupportingIndexes];

  for (const { table, columns } of allIndexes) {
    operations.push(buildAddIndexOp(table, columns));
  }

  // 5. Add foreign keys
  for (const { table, columns, ref } of changes.addedForeignKeys) {
    operations.push(buildAddForeignKeyOp(table, columns, ref, normalizedB.tables[table]));
  }

  return operations;
}

/**
 * Build addTable operation
 */
function buildAddTableOp(tableName: string, tableDef: any): AddTableOp {
  const columns = Object.entries(tableDef.columns || {}).map(([name, col]: [string, any]) => ({
    name,
    type: col.type,
    nullable: col.nullable,
    default: col.default,
  }));

  const constraints = [];

  // Add primary key constraint
  if (tableDef.primaryKey) {
    constraints.push({
      kind: 'primaryKey' as const,
      columns: tableDef.primaryKey.columns,
      name: generateConstraintName('primaryKey', tableName, tableDef.primaryKey.columns),
    });
  }

  // Add unique constraints
  for (const unique of tableDef.uniques || []) {
    constraints.push({
      kind: 'unique' as const,
      columns: unique.columns,
      name: generateConstraintName('unique', tableName, unique.columns),
    });
  }

  // Add foreign key constraints
  for (const fk of tableDef.foreignKeys || []) {
    constraints.push({
      kind: 'foreignKey' as const,
      columns: fk.columns,
      ref: fk.references,
      name: generateConstraintName('foreignKey', tableName, fk.columns),
      onDelete: fk.onDelete,
      onUpdate: fk.onUpdate,
    });
  }

  return {
    kind: 'addTable',
    name: tableName,
    columns,
    constraints: constraints.length > 0 ? constraints : undefined,
  };
}

/**
 * Build addColumn operation
 */
function buildAddColumnOp(tableName: string, columnName: string, columnDef: any): AddColumnOp {
  return {
    kind: 'addColumn',
    table: tableName,
    column: {
      name: columnName,
      type: columnDef.type,
      nullable: columnDef.nullable,
      default: columnDef.default,
    },
  };
}

/**
 * Build addUnique operation
 */
function buildAddUniqueOp(tableName: string, columns: string[]): AddUniqueOp {
  return {
    kind: 'addUnique',
    table: tableName,
    columns,
    name: generateConstraintName('unique', tableName, columns),
  };
}

/**
 * Build addIndex operation
 */
function buildAddIndexOp(tableName: string, columns: string[]): AddIndexOp {
  return {
    kind: 'addIndex',
    table: tableName,
    columns: columns.map((name) => ({ name })),
    name: generateConstraintName('index', tableName, columns),
  };
}

/**
 * Build addForeignKey operation
 */
function buildAddForeignKeyOp(
  tableName: string,
  columns: string[],
  ref: { table: string; columns: string[] },
  tableDef: any,
): AddForeignKeyOp {
  // Find the FK definition to get onDelete/onUpdate
  const fkDef = (tableDef.foreignKeys || []).find(
    (fk: any) =>
      columnSetsEqual(fk.columns, columns) &&
      fk.references.table === ref.table &&
      columnSetsEqual(fk.references.columns, ref.columns),
  );

  return {
    kind: 'addForeignKey',
    table: tableName,
    columns,
    ref,
    name: generateConstraintName('foreignKey', tableName, columns),
    onDelete: fkDef?.onDelete,
    onUpdate: fkDef?.onUpdate,
  };
}

/**
 * Build FK supporting indexes (check if columns are already covered)
 */
function buildFkSupportingIndexes(
  addedForeignKeys: Array<{
    table: string;
    columns: string[];
    ref: { table: string; columns: string[] };
  }>,
  contractA: NormalizedContract,
  contractB: NormalizedContract,
): Array<{ table: string; columns: string[] }> {
  const supportingIndexes: Array<{ table: string; columns: string[] }> = [];

  for (const { table, columns } of addedForeignKeys) {
    if (!isIndexCovered(table, columns, contractA, contractB)) {
      supportingIndexes.push({ table, columns });
    }
  }

  return supportingIndexes;
}

/**
 * Check if columns are covered by existing PK, unique, or index
 */
function isIndexCovered(
  tableName: string,
  columns: string[],
  contractA: NormalizedContract,
  contractB: NormalizedContract,
): boolean {
  const tableA = contractA.tables[tableName];
  const tableB = contractB.tables[tableName];

  if (!tableA || !tableB) return false;

  // Check if covered by primary key in contractB (the target state)
  if (tableB.primaryKey && isLeftPrefixMatch(columns, tableB.primaryKey.columns)) {
    return true;
  }

  // Check if covered by unique constraint in contractB
  const uniquesB = tableB.uniques || [];
  for (const unique of uniquesB) {
    if (isLeftPrefixMatch(columns, unique.columns)) {
      return true;
    }
  }

  // Check if covered by existing index in contractB (left-prefix match)
  const indexesB = tableB.indexes || [];
  for (const index of indexesB) {
    if (isLeftPrefixMatch(columns, index.columns)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if columns form a left-prefix of index columns
 */
function isLeftPrefixMatch(columns: string[], indexColumns: string[]): boolean {
  if (columns.length > indexColumns.length) return false;

  return columns.every((col, i) => col === indexColumns[i]);
}

/**
 * Normalize contract for comparison
 */
function normalizeContract(contract: Contract | { kind: 'empty' }): NormalizedContract {
  if ('kind' in contract && contract.kind === 'empty') {
    return { tables: {} };
  }

  return {
    tables: contract.tables || {},
  };
}
