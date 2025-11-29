import type {
  ForeignKey,
  Index,
  PrimaryKey,
  SqlContract,
  SqlStorage,
  StorageColumn,
  StorageTable,
  UniqueConstraint,
} from '@prisma-next/sql-contract/types';
import type {
  SqlColumnIR,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlSchemaIR,
  SqlTableIR,
  SqlUniqueIR,
} from '@prisma-next/sql-schema-ir/types';
import { SqlMigrationPlanningError } from './errors';
import type { MigrationPolicy, SqlMigrationOperation, SqlMigrationPlan } from './ir';

/**
 * Helper to compare arrays for equality (order-sensitive).
 */
function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Helper to check if a unique constraint matches.
 */
function uniqueMatches(contractUnique: UniqueConstraint, schemaUnique: SqlUniqueIR): boolean {
  return arraysEqual(contractUnique.columns, schemaUnique.columns);
}

/**
 * Helper to check if a foreign key matches.
 */
function foreignKeyMatches(contractFK: ForeignKey, schemaFK: SqlForeignKeyIR): boolean {
  return (
    arraysEqual(contractFK.columns, schemaFK.columns) &&
    contractFK.references.table === schemaFK.referencedTable &&
    arraysEqual(contractFK.references.columns, schemaFK.referencedColumns)
  );
}

/**
 * Helper to check if an index matches (non-unique indexes only).
 */
function indexMatches(contractIndex: Index, schemaIndex: SqlIndexIR): boolean {
  return arraysEqual(contractIndex.columns, schemaIndex.columns) && !schemaIndex.unique;
}

/**
 * Helper to check if a primary key matches.
 */
function primaryKeyMatches(contractPK: PrimaryKey, schemaPK: PrimaryKey | undefined): boolean {
  if (!schemaPK) {
    return false;
  }
  return arraysEqual(contractPK.columns, schemaPK.columns);
}

/**
 * Helper to check if a column type is compatible.
 * For init mode, we check if types match exactly or if the schema column
 * can be widened to match the contract (e.g., nullable -> non-nullable is not allowed in init).
 * Compares native types directly (not codec IDs).
 */
function columnTypeCompatible(contractColumn: StorageColumn, schemaColumn: SqlColumnIR): boolean {
  if (contractColumn.nativeType !== schemaColumn.nativeType) {
    return false;
  }
  // Nullability: contract nullable=true can match schema nullable=true or false (widening)
  // contract nullable=false can only match schema nullable=false (no narrowing)
  if (!contractColumn.nullable && schemaColumn.nullable) {
    return false; // Contract requires non-nullable, schema has nullable - conflict
  }
  return true;
}

/**
 * Plans migration operations for tables.
 */
function planTableOperations(
  contractTable: StorageTable,
  tableName: string,
  schemaTable: SqlTableIR | undefined,
  policy: MigrationPolicy,
  operations: SqlMigrationOperation[],
): void {
  if (!schemaTable) {
    // Table missing - create it with all columns and constraints
    if (!policy.allowedOperationClasses.includes('additive')) {
      throw new SqlMigrationPlanningError(
        `Cannot create table "${tableName}": additive operations not allowed`,
        'PN-MIGRATION-0001',
        { table: tableName, operation: 'createTable' },
      );
    }

    const createTableOp: SqlMigrationOperation = {
      kind: 'createTable',
      table: tableName,
      columns: contractTable.columns,
      ...(contractTable.primaryKey && { primaryKey: contractTable.primaryKey }),
      uniques: contractTable.uniques,
      indexes: contractTable.indexes,
      foreignKeys: contractTable.foreignKeys,
    };
    operations.push(createTableOp);
    return;
  }

  // Table exists - plan column and constraint operations
  // Plan missing columns
  for (const [columnName, contractColumnUnknown] of Object.entries(contractTable.columns)) {
    const contractColumn = contractColumnUnknown as StorageColumn;
    const schemaColumn = schemaTable.columns[columnName];
    if (!schemaColumn) {
      // Column missing - add it
      if (!policy.allowedOperationClasses.includes('additive')) {
        throw new SqlMigrationPlanningError(
          `Cannot add column "${tableName}"."${columnName}": additive operations not allowed`,
          'PN-MIGRATION-0001',
          { table: tableName, column: columnName, operation: 'addColumn' },
        );
      }
      operations.push({
        kind: 'addColumn',
        table: tableName,
        column: columnName,
        definition: contractColumn,
      });
    } else {
      // Column exists - check compatibility
      if (!columnTypeCompatible(contractColumn, schemaColumn)) {
        throw new SqlMigrationPlanningError(
          `Column "${tableName}"."${columnName}" has incompatible type or nullability: contract requires nativeType "${contractColumn.nativeType}" nullable=${contractColumn.nullable}, schema has nativeType "${schemaColumn.nativeType}" nullable=${schemaColumn.nullable}`,
          'PN-MIGRATION-0002',
          {
            table: tableName,
            column: columnName,
            contractNativeType: contractColumn.nativeType,
            contractNullable: contractColumn.nullable,
            schemaNativeType: schemaColumn.nativeType,
            schemaNullable: schemaColumn.nullable,
          },
        );
      }
    }
  }

  // Plan missing primary key
  if (contractTable.primaryKey) {
    if (!primaryKeyMatches(contractTable.primaryKey, schemaTable.primaryKey)) {
      if (schemaTable.primaryKey) {
        // Conflicting primary key exists
        throw new SqlMigrationPlanningError(
          `Table "${tableName}" has conflicting primary key: contract requires columns [${contractTable.primaryKey.columns.join(', ')}], schema has columns [${schemaTable.primaryKey.columns.join(', ')}]`,
          'PN-MIGRATION-0003',
          {
            table: tableName,
            contractPK: contractTable.primaryKey.columns,
            schemaPK: schemaTable.primaryKey.columns,
          },
        );
      }
      // Missing primary key - add it
      if (!policy.allowedOperationClasses.includes('additive')) {
        throw new SqlMigrationPlanningError(
          `Cannot add primary key to table "${tableName}": additive operations not allowed`,
          'PN-MIGRATION-0001',
          { table: tableName, operation: 'addPrimaryKey' },
        );
      }
      operations.push({
        kind: 'addPrimaryKey',
        table: tableName,
        primaryKey: contractTable.primaryKey,
      });
    }
  }

  // Plan missing unique constraints
  for (const contractUnique of contractTable.uniques) {
    const matchingUnique = schemaTable.uniques.find((u: SqlUniqueIR) =>
      uniqueMatches(contractUnique, u),
    );
    if (!matchingUnique) {
      if (!policy.allowedOperationClasses.includes('additive')) {
        throw new SqlMigrationPlanningError(
          `Cannot add unique constraint to table "${tableName}": additive operations not allowed`,
          'PN-MIGRATION-0001',
          { table: tableName, operation: 'addUniqueConstraint' },
        );
      }
      operations.push({
        kind: 'addUniqueConstraint',
        table: tableName,
        unique: contractUnique,
      });
    }
  }

  // Plan missing foreign keys
  for (const contractFK of contractTable.foreignKeys) {
    const matchingFK = schemaTable.foreignKeys.find((fk: SqlForeignKeyIR) =>
      foreignKeyMatches(contractFK, fk),
    );
    if (!matchingFK) {
      // Foreign key missing - add it
      // Note: We don't check if referenced table exists here because:
      // 1. For init mode, referenced tables will be created before FKs are added (planner orders operations)
      // 2. The runner will validate dependencies when applying operations
      if (!policy.allowedOperationClasses.includes('additive')) {
        throw new SqlMigrationPlanningError(
          `Cannot add foreign key to table "${tableName}": additive operations not allowed`,
          'PN-MIGRATION-0001',
          { table: tableName, operation: 'addForeignKey' },
        );
      }
      operations.push({
        kind: 'addForeignKey',
        table: tableName,
        foreignKey: contractFK,
      });
    }
  }

  // Plan missing indexes
  for (const contractIndex of contractTable.indexes) {
    const matchingIndex = schemaTable.indexes.find((idx: SqlIndexIR) =>
      indexMatches(contractIndex, idx),
    );
    if (!matchingIndex) {
      if (!policy.allowedOperationClasses.includes('additive')) {
        throw new SqlMigrationPlanningError(
          `Cannot add index to table "${tableName}": additive operations not allowed`,
          'PN-MIGRATION-0001',
          { table: tableName, operation: 'addIndex' },
        );
      }
      operations.push({
        kind: 'addIndex',
        table: tableName,
        index: contractIndex,
      });
    }
  }
}

/**
 * Plans extension operations.
 */
function planExtensionOperations(
  contractExtensions: Record<string, unknown> | undefined,
  schemaExtensions: readonly string[],
  contractTarget: string,
  policy: MigrationPolicy,
  operations: SqlMigrationOperation[],
): void {
  if (!contractExtensions) {
    return;
  }

  // Extract extension names from contract (keys of extensions object)
  // Filter out the target name - it's not an extension
  const contractExtensionNames = Object.keys(contractExtensions).filter(
    (name) => name !== contractTarget,
  );

  // Check each contract extension exists in schema
  for (const extName of contractExtensionNames) {
    const extConfig = contractExtensions[extName];
    // Check if extension is enabled (e.g., extensions.pgvector.enabled === true)
    const enabled =
      typeof extConfig === 'object' &&
      extConfig !== null &&
      'enabled' in extConfig &&
      extConfig.enabled === true;

    if (!enabled) {
      continue; // Extension not enabled in contract, skip
    }

    // Normalize extension names for comparison (remove common prefixes like 'pg')
    const normalizedExtName = extName.toLowerCase().replace(/^pg/, '');
    const matchingExt = schemaExtensions.find((e) => {
      const normalizedE = e.toLowerCase();
      // Exact match
      if (normalizedE === normalizedExtName || normalizedE === extName.toLowerCase()) {
        return true;
      }
      // Check if one contains the other (e.g., 'pgvector' contains 'vector', 'vector' is in 'pgvector')
      if (normalizedE.includes(normalizedExtName) || normalizedExtName.includes(normalizedE)) {
        return true;
      }
      return false;
    });

    if (!matchingExt) {
      // Extension missing - plan operation to create it
      if (!policy.allowedOperationClasses.includes('additive')) {
        throw new SqlMigrationPlanningError(
          `Cannot create extension "${extName}": additive operations not allowed`,
          'PN-MIGRATION-0001',
          { extension: extName, operation: 'extensionOperation' },
        );
      }
      operations.push({
        kind: 'extensionOperation',
        extensionId: extName,
        operationId: 'createExtension',
        args: { extensionName: extName },
      });
    }
  }
}

/**
 * Plans migration operations from one contract to another, consulting live schema.
 * This is the core planning algorithm for db init and db update.
 */
export function planMigration(input: {
  readonly fromContract: SqlContract<SqlStorage>;
  readonly toContract: SqlContract<SqlStorage>;
  readonly liveSchema: SqlSchemaIR;
  readonly policy: MigrationPolicy;
}): SqlMigrationPlan {
  const { fromContract, toContract, liveSchema, policy } = input;

  // Validate that both contracts have the same target
  if (fromContract.target !== toContract.target) {
    throw new SqlMigrationPlanningError(
      `Cannot plan migration: contracts have different targets (from: "${fromContract.target}", to: "${toContract.target}")`,
      'PN-MIGRATION-0004',
      {
        fromTarget: fromContract.target,
        toTarget: toContract.target,
      },
    );
  }

  const operations: SqlMigrationOperation[] = [];

  // Plan table operations
  for (const [tableName, contractTableUnknown] of Object.entries(toContract.storage.tables)) {
    const contractTable = contractTableUnknown as StorageTable;
    const schemaTable = liveSchema.tables[tableName];
    planTableOperations(contractTable, tableName, schemaTable, policy, operations);
  }

  // Plan extension operations
  planExtensionOperations(
    toContract.extensions as Record<string, unknown> | undefined,
    liveSchema.extensions,
    toContract.target,
    policy,
    operations,
  );

  // Build summary
  const operationCounts = {
    createTable: operations.filter((op) => op.kind === 'createTable').length,
    addColumn: operations.filter((op) => op.kind === 'addColumn').length,
    addPrimaryKey: operations.filter((op) => op.kind === 'addPrimaryKey').length,
    addUniqueConstraint: operations.filter((op) => op.kind === 'addUniqueConstraint').length,
    addForeignKey: operations.filter((op) => op.kind === 'addForeignKey').length,
    addIndex: operations.filter((op) => op.kind === 'addIndex').length,
    extensionOperation: operations.filter((op) => op.kind === 'extensionOperation').length,
  };

  const totalOps = operations.length;
  const summary =
    totalOps === 0
      ? 'No operations needed (database already satisfies contract)'
      : `Planned ${totalOps} operation${totalOps === 1 ? '' : 's'}: ${operationCounts.createTable} create table, ${operationCounts.addColumn} add column, ${operationCounts.addPrimaryKey} add primary key, ${operationCounts.addUniqueConstraint} add unique, ${operationCounts.addForeignKey} add foreign key, ${operationCounts.addIndex} add index, ${operationCounts.extensionOperation} extension operation${operationCounts.extensionOperation === 1 ? '' : 's'}`;

  return {
    fromContract,
    toContract,
    operations,
    mode: policy.mode,
    summary,
  };
}
