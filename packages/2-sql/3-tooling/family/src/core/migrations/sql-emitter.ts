import type {
  ForeignKey,
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import type { SqlMigrationPlanOperation } from './types';

/**
 * Input for emitting a createTable operation.
 */
export interface EmitCreateTableInput {
  readonly tableName: string;
  readonly table: StorageTable;
}

/**
 * Input for emitting an addColumn operation.
 */
export interface EmitAddColumnInput {
  readonly tableName: string;
  readonly columnName: string;
  readonly column: StorageColumn;
}

/**
 * Input for emitting an addPrimaryKey operation.
 */
export interface EmitAddPrimaryKeyInput {
  readonly tableName: string;
  readonly constraintName: string;
  readonly columns: readonly string[];
}

/**
 * Input for emitting an addUniqueConstraint operation.
 */
export interface EmitAddUniqueConstraintInput {
  readonly tableName: string;
  readonly constraintName: string;
  readonly columns: readonly string[];
}

/**
 * Input for emitting a createIndex operation.
 */
export interface EmitCreateIndexInput {
  readonly tableName: string;
  readonly indexName: string;
  readonly columns: readonly string[];
}

/**
 * Input for emitting an addForeignKey operation.
 */
export interface EmitAddForeignKeyInput {
  readonly tableName: string;
  readonly constraintName: string;
  readonly foreignKey: ForeignKey;
}

/**
 * Input for emitting an enableExtension operation.
 */
export interface EmitEnableExtensionInput {
  readonly extension: string;
  readonly dependencyId: string;
}

/**
 * Input for emitting a createStorageType operation.
 */
export interface EmitCreateStorageTypeInput {
  readonly typeName: string;
  readonly typeInstance: StorageTypeInstance;
}

/**
 * Interface for target-specific SQL generation.
 *
 * The contract planner performs structural diffing of two SqlStorage objects and
 * determines *what* changed. The SqlEmitter determines *how* to express those
 * changes as SQL. This separation keeps the planner target-agnostic while
 * allowing each target (Postgres, MySQL, etc.) to generate its own DDL.
 *
 * Each method receives the structural input needed for that operation type and
 * returns a fully formed SqlMigrationPlanOperation with precheck, execute, and
 * postcheck SQL steps.
 */
export interface SqlEmitter {
  emitCreateTable(input: EmitCreateTableInput): SqlMigrationPlanOperation<unknown>;
  emitAddColumn(input: EmitAddColumnInput): SqlMigrationPlanOperation<unknown>;
  emitAddPrimaryKey(input: EmitAddPrimaryKeyInput): SqlMigrationPlanOperation<unknown>;
  emitAddUniqueConstraint(input: EmitAddUniqueConstraintInput): SqlMigrationPlanOperation<unknown>;
  emitCreateIndex(input: EmitCreateIndexInput): SqlMigrationPlanOperation<unknown>;
  emitAddForeignKey(input: EmitAddForeignKeyInput): SqlMigrationPlanOperation<unknown>;
  emitEnableExtension(input: EmitEnableExtensionInput): SqlMigrationPlanOperation<unknown>;
  emitCreateStorageType(input: EmitCreateStorageTypeInput): SqlMigrationPlanOperation<unknown>;
}
