import type { StorageColumn } from '@prisma-next/sql-contract/types';
import type {
  AddColumnOperation,
  AddForeignKeyOperation,
  AddIndexOperation,
  AddPrimaryKeyOperation,
  AddUniqueConstraintOperation,
  CreateTableOperation,
  ExtensionOperation,
  SqlMigrationOperation,
} from './ir';

/**
 * SQL statement with parameters.
 */
export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * Quotes a PostgreSQL identifier, escaping double quotes.
 */
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Generates SQL column definition from StorageColumn.
 */
function columnDefinition(columnName: string, column: StorageColumn): string {
  const quotedName = quoteIdentifier(columnName);
  const type = column.nativeType;
  const nullable = column.nullable ? '' : ' NOT NULL';
  return `${quotedName} ${type}${nullable}`;
}

/**
 * Generates SQL for creating a table with all columns, primary key, and unique constraints.
 * Foreign keys and indexes are handled by separate operations (addForeignKey, addIndex).
 */
export function executeCreateTable(operation: CreateTableOperation): SqlStatement {
  const tableName = quoteIdentifier(operation.table);
  const columns: string[] = [];

  // Add all columns
  for (const [columnName, column] of Object.entries(operation.columns)) {
    columns.push(columnDefinition(columnName, column));
  }

  // Add primary key constraint (if present)
  if (operation.primaryKey) {
    const pkColumns = operation.primaryKey.columns.map(quoteIdentifier).join(', ');
    const pkName = operation.primaryKey.name
      ? `CONSTRAINT ${quoteIdentifier(operation.primaryKey.name)} `
      : '';
    columns.push(`${pkName}PRIMARY KEY (${pkColumns})`);
  }

  // Add unique constraints (if present)
  for (const unique of operation.uniques) {
    const uniqueColumns = unique.columns.map(quoteIdentifier).join(', ');
    const uniqueName = unique.name
      ? `CONSTRAINT ${quoteIdentifier(unique.name)} `
      : '';
    columns.push(`${uniqueName}UNIQUE (${uniqueColumns})`);
  }

  const sql = `CREATE TABLE IF NOT EXISTS ${tableName} (${columns.join(', ')})`;

  return {
    sql,
    params: [],
  };
}

/**
 * Generates SQL for adding a column to an existing table.
 */
export function executeAddColumn(operation: AddColumnOperation): SqlStatement {
  const tableName = quoteIdentifier(operation.table);
  const columnDef = columnDefinition(operation.column, operation.definition);

  // PostgreSQL doesn't support IF NOT EXISTS for ADD COLUMN, so we use a DO block
  // that checks if the column exists before adding it
  const sql = `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = '${operation.table.replace(/'/g, "''")}'
          AND column_name = '${operation.column.replace(/'/g, "''")}'
      ) THEN
        ALTER TABLE ${tableName} ADD COLUMN ${columnDef};
      END IF;
    END $$;
  `.trim();

  return {
    sql,
    params: [],
  };
}

/**
 * Generates SQL for adding a primary key constraint.
 */
export function executeAddPrimaryKey(operation: AddPrimaryKeyOperation): SqlStatement {
  const tableName = quoteIdentifier(operation.table);
  const pkColumns = operation.primaryKey.columns.map(quoteIdentifier).join(', ');
  const pkName = operation.primaryKey.name
    ? `CONSTRAINT ${quoteIdentifier(operation.primaryKey.name)} `
    : '';

  const sql = `ALTER TABLE ${tableName} ADD ${pkName}PRIMARY KEY (${pkColumns})`;

  return {
    sql,
    params: [],
  };
}

/**
 * Generates SQL for adding a unique constraint.
 */
export function executeAddUniqueConstraint(operation: AddUniqueConstraintOperation): SqlStatement {
  const tableName = quoteIdentifier(operation.table);
  const uniqueColumns = operation.unique.columns.map(quoteIdentifier).join(', ');
  const uniqueName = operation.unique.name
    ? `CONSTRAINT ${quoteIdentifier(operation.unique.name)} `
    : '';

  const sql = `ALTER TABLE ${tableName} ADD ${uniqueName}UNIQUE (${uniqueColumns})`;

  return {
    sql,
    params: [],
  };
}

/**
 * Generates SQL for adding a foreign key constraint.
 */
export function executeAddForeignKey(operation: AddForeignKeyOperation): SqlStatement {
  const tableName = quoteIdentifier(operation.table);
  const fkColumns = operation.foreignKey.columns.map(quoteIdentifier).join(', ');
  const refTable = quoteIdentifier(operation.foreignKey.references.table);
  const refColumns = operation.foreignKey.references.columns.map(quoteIdentifier).join(', ');
  const fkName = operation.foreignKey.name
    ? `CONSTRAINT ${quoteIdentifier(operation.foreignKey.name)} `
    : '';

  const sql = `ALTER TABLE ${tableName} ADD ${fkName}FOREIGN KEY (${fkColumns}) REFERENCES ${refTable} (${refColumns})`;

  return {
    sql,
    params: [],
  };
}

/**
 * Generates SQL for creating an index.
 */
export function executeAddIndex(operation: AddIndexOperation): SqlStatement {
  const tableName = quoteIdentifier(operation.table);
  const indexColumns = operation.index.columns.map(quoteIdentifier).join(', ');
  const indexName = operation.index.name
    ? quoteIdentifier(operation.index.name)
    : `"idx_${operation.table}_${operation.index.columns.join('_')}"`;

  const sql = `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${indexColumns})`;

  return {
    sql,
    params: [],
  };
}

/**
 * Generates SQL for extension operations.
 * For v1, this is a placeholder that will be enhanced to delegate to extension packs.
 */
export function executeExtensionOperation(_operation: ExtensionOperation): SqlStatement {
  // TODO: Delegate to extension pack executors
  // For v1, throw an error indicating this needs extension pack integration
  throw new Error(
    `Extension operations are not yet supported. Operation: ${_operation.extensionId}.${_operation.operationId}`,
  );
}

/**
 * Executes a migration operation and returns the SQL statement.
 */
export function executeOperation(operation: SqlMigrationOperation): SqlStatement {
  switch (operation.kind) {
    case 'createTable':
      return executeCreateTable(operation);
    case 'addColumn':
      return executeAddColumn(operation);
    case 'addPrimaryKey':
      return executeAddPrimaryKey(operation);
    case 'addUniqueConstraint':
      return executeAddUniqueConstraint(operation);
    case 'addForeignKey':
      return executeAddForeignKey(operation);
    case 'addIndex':
      return executeAddIndex(operation);
    case 'extensionOperation':
      return executeExtensionOperation(operation);
    default:
      // Exhaustiveness check
      const _exhaustive: never = operation;
      throw new Error(`Unknown operation kind: ${(_exhaustive as { kind: string }).kind}`);
  }
}

