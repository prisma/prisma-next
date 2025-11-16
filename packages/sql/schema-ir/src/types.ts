/**
 * SQL Schema IR types for target-agnostic schema representation.
 *
 * These types represent the canonical in-memory representation of SQL schemas
 * for the SQL family, used for verification and future migration planning.
 */

import type { PrimaryKey } from '@prisma-next/sql-contract/types';

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
  readonly typeId: string; // codec id, e.g. 'pg/int4@1'
  readonly nativeType?: string; // explicit DB type, e.g. 'integer', 'vector'
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
