/**
 * Abstract migration operation IR.
 *
 * These types define the target-agnostic operation vocabulary for on-disk
 * migration persistence. Operations are produced by the contract-to-contract
 * planner and resolved to target-specific SQL (or equivalent) at apply time
 * by the target adapter.
 *
 * The vocabulary covers the additive operations supported by the MVP:
 * - enableExtension
 * - createStorageType
 * - createTable
 * - addColumn
 * - addPrimaryKey
 * - addUniqueConstraint
 * - createIndex
 * - addForeignKey
 *
 * Each operation carries enough information for a target adapter to generate
 * deterministic DDL without re-reading the contract.
 */

import type { MigrationOperationClass } from './migrations';

// ============================================================================
// Sentinel Values
// ============================================================================

/**
 * Sentinel value representing the absence of a contract (empty/new project).
 * This is a human-readable marker, not a real SHA-256 hash.
 */
export const EMPTY_CONTRACT_HASH = 'sha256:empty' as const;

// ============================================================================
// Pre/Post Check Vocabulary (ADR 044)
// ============================================================================

/**
 * A structured pre/post check per ADR 044.
 * Checks are target-agnostic predicates that can be resolved to
 * target-specific queries at apply time.
 */
export type AbstractCheck =
  | { readonly id: 'tableExists'; readonly params: { readonly table: string } }
  | { readonly id: 'tableNotExists'; readonly params: { readonly table: string } }
  | {
      readonly id: 'columnExists';
      readonly params: { readonly table: string; readonly column: string };
    }
  | {
      readonly id: 'columnNotExists';
      readonly params: { readonly table: string; readonly column: string };
    }
  | {
      readonly id: 'columnIsNotNull';
      readonly params: { readonly table: string; readonly column: string };
    }
  | { readonly id: 'tableIsEmpty'; readonly params: { readonly table: string } }
  | {
      readonly id: 'constraintNotExists';
      readonly params: { readonly table: string; readonly name: string };
    }
  | {
      readonly id: 'constraintExists';
      readonly params: { readonly table: string; readonly name: string };
    }
  | {
      readonly id: 'indexNotExists';
      readonly params: { readonly table: string; readonly name: string };
    }
  | {
      readonly id: 'indexExists';
      readonly params: { readonly table: string; readonly name: string };
    }
  | {
      readonly id: 'extensionNotInstalled';
      readonly params: { readonly extension: string };
    }
  | {
      readonly id: 'extensionInstalled';
      readonly params: { readonly extension: string };
    }
  | {
      readonly id: 'primaryKeyNotExists';
      readonly params: { readonly table: string };
    }
  | {
      readonly id: 'primaryKeyExists';
      readonly params: { readonly table: string; readonly name?: string };
    };

// ============================================================================
// Column Definition (shared by createTable and addColumn)
// ============================================================================

/**
 * Column default value definition.
 * Matches the contract's ColumnDefault type.
 */
export type AbstractColumnDefault =
  | { readonly kind: 'literal'; readonly expression: string }
  | { readonly kind: 'function'; readonly expression: string }
  | { readonly kind: 'sequence'; readonly name: string };

/**
 * Full column definition as carried in abstract ops.
 * Contains all information needed for DDL generation.
 */
export interface AbstractColumnDefinition {
  /** Column name. */
  readonly name: string;
  /** Native database type (e.g., 'text', 'integer', 'boolean'). */
  readonly nativeType: string;
  /** Codec identifier for runtime type encoding/decoding. */
  readonly codecId: string;
  /** Whether the column allows NULL values. */
  readonly nullable: boolean;
  /** Default value expression, if any. */
  readonly default?: AbstractColumnDefault;
  /** Type parameters for parameterized types (e.g., vector dimension). */
  readonly typeParams?: Record<string, unknown>;
  /** Reference to a named storage type instance. */
  readonly typeRef?: string;
}

// ============================================================================
// Abstract Operations
// ============================================================================

/**
 * Base interface shared by all abstract operations.
 */
interface AbstractOpBase {
  /** Discriminant identifying the operation type. */
  readonly op: string;
  /** Unique identifier for this operation (e.g., 'table.users'). */
  readonly id: string;
  /** Human-readable label for display. */
  readonly label: string;
  /** Safety classification of this operation. */
  readonly operationClass: MigrationOperationClass;
  /** Precondition checks — must all pass before execution. */
  readonly pre: readonly AbstractCheck[];
  /** Postcondition checks — must all pass after execution. */
  readonly post: readonly AbstractCheck[];
}

/**
 * Enable a database extension (e.g., pgvector, postgis).
 */
export interface EnableExtensionOp extends AbstractOpBase {
  readonly op: 'enableExtension';
  readonly args: {
    /** Extension name as known to the database (e.g., 'vector', 'postgis'). */
    readonly extension: string;
    /** The component dependency ID that owns this extension. */
    readonly dependencyId: string;
  };
}

/**
 * Create a custom storage type via a codec hook (e.g., enum, composite).
 */
export interface CreateStorageTypeOp extends AbstractOpBase {
  readonly op: 'createStorageType';
  readonly args: {
    /** Name of the storage type instance. */
    readonly typeName: string;
    /** Codec identifier. */
    readonly codecId: string;
    /** Native database type name. */
    readonly nativeType: string;
    /** Codec-specific type parameters. */
    readonly typeParams: Record<string, unknown>;
  };
}

/**
 * Create a new table with columns and optionally an inline primary key.
 */
export interface CreateTableOp extends AbstractOpBase {
  readonly op: 'createTable';
  readonly args: {
    /** Table name. */
    readonly table: string;
    /** Column definitions in deterministic order. */
    readonly columns: readonly AbstractColumnDefinition[];
    /** Primary key constraint, if any. Included inline in CREATE TABLE. */
    readonly primaryKey?: {
      readonly columns: readonly string[];
      readonly name?: string;
    };
  };
}

/**
 * Add a column to an existing table.
 */
export interface AddColumnOp extends AbstractOpBase {
  readonly op: 'addColumn';
  readonly args: {
    /** Table name. */
    readonly table: string;
    /** Column definition. */
    readonly column: AbstractColumnDefinition;
  };
}

/**
 * Add a primary key constraint to an existing table.
 * Used when the table was created without a PK (e.g., added incrementally).
 */
export interface AddPrimaryKeyOp extends AbstractOpBase {
  readonly op: 'addPrimaryKey';
  readonly args: {
    /** Table name. */
    readonly table: string;
    /** Constraint name. */
    readonly constraintName: string;
    /** Columns composing the primary key. */
    readonly columns: readonly string[];
  };
}

/**
 * Add a unique constraint to a table.
 */
export interface AddUniqueConstraintOp extends AbstractOpBase {
  readonly op: 'addUniqueConstraint';
  readonly args: {
    /** Table name. */
    readonly table: string;
    /** Constraint name. */
    readonly constraintName: string;
    /** Columns composing the unique constraint. */
    readonly columns: readonly string[];
  };
}

/**
 * Create an index on a table.
 */
export interface CreateIndexOp extends AbstractOpBase {
  readonly op: 'createIndex';
  readonly args: {
    /** Table name. */
    readonly table: string;
    /** Index name. */
    readonly indexName: string;
    /** Columns composing the index. */
    readonly columns: readonly string[];
  };
}

/**
 * Add a foreign key constraint to a table.
 */
export interface AddForeignKeyOp extends AbstractOpBase {
  readonly op: 'addForeignKey';
  readonly args: {
    /** Table name. */
    readonly table: string;
    /** Constraint name. */
    readonly constraintName: string;
    /** Columns in the referencing table. */
    readonly columns: readonly string[];
    /** Referenced table name. */
    readonly referencedTable: string;
    /** Referenced columns. */
    readonly referencedColumns: readonly string[];
  };
}

// ============================================================================
// Union Type
// ============================================================================

/**
 * Union of all abstract migration operations.
 * This is what the contract-to-contract planner produces and what
 * gets serialized to `ops.json` on disk.
 */
export type AbstractOp =
  | EnableExtensionOp
  | CreateStorageTypeOp
  | CreateTableOp
  | AddColumnOp
  | AddPrimaryKeyOp
  | AddUniqueConstraintOp
  | CreateIndexOp
  | AddForeignKeyOp;

// ============================================================================
// Planner Result Types
// ============================================================================

/**
 * Conflict detected during contract-to-contract planning.
 */
export interface ContractDiffConflict {
  /** Kind of conflict. */
  readonly kind:
    | 'typeMismatch'
    | 'nullabilityConflict'
    | 'columnRemoved'
    | 'tableRemoved'
    | 'primaryKeyChanged'
    | 'unsupportedChange';
  /** Human-readable summary. */
  readonly summary: string;
  /** Location of the conflict. */
  readonly location?: {
    readonly table?: string;
    readonly column?: string;
    readonly constraint?: string;
  };
}

/**
 * Successful contract diff result.
 */
export interface ContractDiffSuccess {
  readonly kind: 'success';
  /** Ordered list of abstract operations. */
  readonly ops: readonly AbstractOp[];
}

/**
 * Failed contract diff result (non-additive changes detected).
 */
export interface ContractDiffFailure {
  readonly kind: 'failure';
  /** Conflicts that prevented planning. */
  readonly conflicts: readonly ContractDiffConflict[];
}

/**
 * Result of a contract-to-contract diff operation.
 */
export type ContractDiffResult = ContractDiffSuccess | ContractDiffFailure;
