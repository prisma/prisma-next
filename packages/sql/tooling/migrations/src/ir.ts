import type {
  ForeignKey,
  Index,
  PrimaryKey,
  SqlContract,
  SqlStorage,
  StorageColumn,
  UniqueConstraint,
} from '@prisma-next/sql-contract/types';

/**
 * Migration operation class classification.
 * Used by MigrationPolicy to control which operations can be emitted.
 */
export type OperationClass = 'additive' | 'widening' | 'destructive';

/**
 * Migration policy governing allowed operation classes.
 * Used by the planner to restrict which operations can be emitted.
 */
export type MigrationPolicy = {
  readonly mode: 'init' | 'update';
  readonly allowedOperationClasses: readonly OperationClass[];
};

/**
 * Create table operation.
 * Creates a new table with all columns, primary key, uniques, indexes, and foreign keys.
 */
export type CreateTableOperation = {
  readonly kind: 'createTable';
  readonly table: string;
  readonly columns: Record<string, StorageColumn>;
  readonly primaryKey?: PrimaryKey;
  readonly uniques: readonly UniqueConstraint[];
  readonly indexes: readonly Index[];
  readonly foreignKeys: readonly ForeignKey[];
};

/**
 * Add column operation.
 * Adds a new column to an existing table.
 */
export type AddColumnOperation = {
  readonly kind: 'addColumn';
  readonly table: string;
  readonly column: string;
  readonly definition: StorageColumn;
};

/**
 * Add primary key operation.
 * Adds a primary key constraint to an existing table.
 */
export type AddPrimaryKeyOperation = {
  readonly kind: 'addPrimaryKey';
  readonly table: string;
  readonly primaryKey: PrimaryKey;
};

/**
 * Add unique constraint operation.
 * Adds a unique constraint to an existing table.
 */
export type AddUniqueConstraintOperation = {
  readonly kind: 'addUniqueConstraint';
  readonly table: string;
  readonly unique: UniqueConstraint;
};

/**
 * Add foreign key operation.
 * Adds a foreign key constraint to an existing table.
 */
export type AddForeignKeyOperation = {
  readonly kind: 'addForeignKey';
  readonly table: string;
  readonly foreignKey: ForeignKey;
};

/**
 * Add index operation.
 * Adds an index to an existing table.
 */
export type AddIndexOperation = {
  readonly kind: 'addIndex';
  readonly table: string;
  readonly index: Index;
};

/**
 * Extension operation.
 * Represents an extension-owned operation (e.g., createExtension('pgvector'), create vector index).
 * Parameterized by a logical operation identifier and arguments.
 */
export type ExtensionOperation = {
  readonly kind: 'extensionOperation';
  readonly extensionId: string;
  readonly operationId: string;
  readonly args?: Record<string, unknown>;
};

/**
 * Union of all SQL migration operations.
 * Represents the additive subset of operations from ADR 028.
 */
export type SqlMigrationOperation =
  | CreateTableOperation
  | AddColumnOperation
  | AddPrimaryKeyOperation
  | AddUniqueConstraintOperation
  | AddForeignKeyOperation
  | AddIndexOperation
  | ExtensionOperation;

/**
 * SQL migration plan IR.
 * In-memory representation of a migration plan, distinct from the serialized on-disk edge model.
 */
export type SqlMigrationPlan = {
  readonly fromContract: SqlContract<SqlStorage>;
  readonly toContract: SqlContract<SqlStorage>;
  readonly operations: readonly SqlMigrationOperation[];
  readonly mode: 'init' | 'update';
  readonly summary?: string;
  readonly diagnostics?: readonly string[];
};
