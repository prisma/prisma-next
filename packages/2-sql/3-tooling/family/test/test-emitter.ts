import type { SqlEmitter } from '../src/core/migrations/sql-emitter';
import type { SqlMigrationPlanOperation } from '../src/core/migrations/types';

/**
 * Minimal SqlEmitter for contract planner tests.
 * Returns operations with enough structure to verify the planner's
 * diffing logic without depending on target-specific SQL.
 */
export function createTestEmitter(): SqlEmitter {
  return {
    emitCreateTable({ tableName, table }) {
      return testOp(`table.${tableName}`, `Create table ${tableName}`, {
        tableName,
        columns: Object.keys(table.columns),
        primaryKey: table.primaryKey ? { columns: [...table.primaryKey.columns] } : undefined,
      });
    },
    emitAddColumn({ tableName, columnName }) {
      return testOp(
        `column.${tableName}.${columnName}`,
        `Add column ${columnName} to ${tableName}`,
        {
          tableName,
          columnName,
        },
      );
    },
    emitAddPrimaryKey({ tableName, constraintName, columns }) {
      return testOp(
        `primaryKey.${tableName}.${constraintName}`,
        `Add primary key ${constraintName} on ${tableName}`,
        {
          tableName,
          constraintName,
          columns: [...columns],
        },
      );
    },
    emitAddUniqueConstraint({ tableName, constraintName, columns }) {
      return testOp(
        `unique.${tableName}.${constraintName}`,
        `Add unique constraint ${constraintName} on ${tableName}`,
        {
          tableName,
          constraintName,
          columns: [...columns],
        },
      );
    },
    emitCreateIndex({ tableName, indexName, columns }) {
      return testOp(
        `index.${tableName}.${indexName}`,
        `Create index ${indexName} on ${tableName}`,
        {
          tableName,
          indexName,
          columns: [...columns],
        },
      );
    },
    emitAddForeignKey({ tableName, constraintName, foreignKey }) {
      return testOp(
        `foreignKey.${tableName}.${constraintName}`,
        `Add foreign key ${constraintName} on ${tableName}`,
        {
          tableName,
          constraintName,
          referencedTable: foreignKey.references.table,
          columns: [...foreignKey.columns],
          referencedColumns: [...foreignKey.references.columns],
        },
      );
    },
    emitEnableExtension({ extension, dependencyId }) {
      return testOp(`extension.${extension}`, `Enable extension ${extension}`, {
        extension,
        dependencyId,
      });
    },
    emitCreateStorageType({ typeName, typeInstance }) {
      return testOp(`storageType.${typeName}`, `Create storage type ${typeName}`, {
        typeName,
        codecId: typeInstance.codecId,
        nativeType: typeInstance.nativeType,
        typeParams: typeInstance.typeParams,
      });
    },
  };
}

function testOp(
  id: string,
  label: string,
  meta: Record<string, unknown>,
): SqlMigrationPlanOperation<unknown> {
  return {
    id,
    label,
    operationClass: 'additive',
    target: { id: 'test' },
    precheck: [],
    execute: [{ description: label, sql: `-- ${label}` }],
    postcheck: [],
    meta,
  };
}
