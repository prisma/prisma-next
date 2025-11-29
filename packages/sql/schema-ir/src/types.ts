/**
 * SQL Schema IR types for target-agnostic schema representation.
 *
 * These types represent the canonical in-memory representation of SQL schemas
 * for the SQL family, used for verification and future migration planning.
 */

/**
 * Primary key definition matching ContractIR format.
 * Defined here to avoid circular dependency with sql-contract.
 */
export type PrimaryKey = {
  readonly columns: readonly string[];
  readonly name?: string;
};

/**
 * Namespaced annotations for extensibility.
 * Each namespace (e.g., 'pg', 'pgvector') owns its annotations.
 */
export type SqlAnnotations = {
  readonly [namespace: string]: unknown;
};

/**
 * SQL column IR representing a column in a table.
 */
export type SqlColumnIR = {
  readonly name: string;
  readonly nativeType: string; // explicit DB type, e.g. 'integer', 'vector'
  readonly nullable: boolean;
  readonly annotations?: SqlAnnotations; // column-level metadata
};

/**
 * SQL foreign key IR.
 */
export type SqlForeignKeyIR = {
  readonly columns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  readonly name?: string;
  readonly annotations?: SqlAnnotations;
};

/**
 * SQL unique constraint IR.
 */
export type SqlUniqueIR = {
  readonly columns: readonly string[];
  readonly name?: string;
  readonly annotations?: SqlAnnotations;
};

/**
 * SQL index IR.
 */
export type SqlIndexIR = {
  readonly columns: readonly string[];
  readonly name?: string;
  readonly unique: boolean;
  readonly annotations?: SqlAnnotations;
};

/**
 * SQL table IR representing a table in the schema.
 * Primary key format matches ContractIR for consistency.
 */
export type SqlTableIR = {
  readonly name: string;
  readonly columns: Record<string, SqlColumnIR>;
  readonly primaryKey?: PrimaryKey; // Matches ContractIR format: { columns: string[]; name?: string }
  readonly foreignKeys: readonly SqlForeignKeyIR[];
  readonly uniques: readonly SqlUniqueIR[];
  readonly indexes: readonly SqlIndexIR[];
  readonly annotations?: SqlAnnotations; // table-level metadata
};

/**
 * SQL Schema IR representing the complete database schema.
 * This is the target-agnostic representation used for verification and migration planning.
 */
export type SqlSchemaIR = {
  readonly tables: Record<string, SqlTableIR>;
  readonly extensions: readonly string[]; // logical extension ids or DB extension names
  readonly annotations?: SqlAnnotations; // extensible global metadata
};

/**
 * SQL type metadata for control-plane and execution-plane type availability and mapping.
 * This abstraction provides a read-only view of type information without encode/decode behavior.
 */
export interface SqlTypeMetadata {
  /**
   * Namespaced type identifier in format 'namespace/name@version'
   * Examples: 'pg/int4@1', 'pg/text@1', 'pg/timestamptz@1'
   */
  readonly typeId: string;

  /**
   * Contract scalar type IDs that this type can handle.
   * Examples: ['text'], ['int4', 'float8'], ['timestamp', 'timestamptz']
   */
  readonly targetTypes: readonly string[];

  /**
   * Native database type name (target-specific).
   * Examples: 'integer', 'text', 'character varying', 'timestamp with time zone'
   * This is optional because not all types have a native database representation.
   */
  readonly nativeType?: string;
}

/**
 * Registry interface for SQL type metadata.
 * Provides read-only iteration over type metadata entries.
 */
export interface SqlTypeMetadataRegistry {
  /**
   * Returns an iterator over all type metadata entries.
   */
  values(): IterableIterator<SqlTypeMetadata>;
}
