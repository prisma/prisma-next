/**
 * Thin operation descriptors for the migration authoring API.
 *
 * Descriptors reference contract elements by name — they do not carry
 * type definitions, defaults, or other schema details. The resolver
 * looks up the actual definitions from the destination contract.
 *
 * At verification time, a resolver converts them to SqlMigrationPlanOperation
 * using the full contract context (codec hooks, schema name, etc.).
 */

import type { SerializedQueryNode } from '@prisma-next/core-control-plane/types';

// ============================================================================
// Table descriptors
// ============================================================================

export interface CreateTableDescriptor {
  readonly kind: 'createTable';
  readonly table: string;
}

export interface DropTableDescriptor {
  readonly kind: 'dropTable';
  readonly table: string;
}

// ============================================================================
// Column descriptors
// ============================================================================

export interface AddColumnDescriptor {
  readonly kind: 'addColumn';
  readonly table: string;
  readonly column: string;
}

export interface DropColumnDescriptor {
  readonly kind: 'dropColumn';
  readonly table: string;
  readonly column: string;
}

export interface AlterColumnTypeDescriptor {
  readonly kind: 'alterColumnType';
  readonly table: string;
  readonly column: string;
}

export interface SetNotNullDescriptor {
  readonly kind: 'setNotNull';
  readonly table: string;
  readonly column: string;
}

export interface DropNotNullDescriptor {
  readonly kind: 'dropNotNull';
  readonly table: string;
  readonly column: string;
}

export interface SetDefaultDescriptor {
  readonly kind: 'setDefault';
  readonly table: string;
  readonly column: string;
}

export interface DropDefaultDescriptor {
  readonly kind: 'dropDefault';
  readonly table: string;
  readonly column: string;
}

// ============================================================================
// Constraint descriptors
// Constraints may need identifying fields (columns) since a table can
// have multiple uniques, FKs, or indexes. The constraint name is optional
// — the resolver derives it from the contract if not provided.
// ============================================================================

export interface AddPrimaryKeyDescriptor {
  readonly kind: 'addPrimaryKey';
  readonly table: string;
}

export interface AddUniqueDescriptor {
  readonly kind: 'addUnique';
  readonly table: string;
  readonly columns: readonly string[];
}

export interface AddForeignKeyDescriptor {
  readonly kind: 'addForeignKey';
  readonly table: string;
  readonly columns: readonly string[];
}

export interface DropConstraintDescriptor {
  readonly kind: 'dropConstraint';
  readonly table: string;
  readonly constraintName: string;
}

// ============================================================================
// Index descriptors
// ============================================================================

export interface CreateIndexDescriptor {
  readonly kind: 'createIndex';
  readonly table: string;
  readonly columns: readonly string[];
}

export interface DropIndexDescriptor {
  readonly kind: 'dropIndex';
  readonly table: string;
  readonly indexName: string;
}

// ============================================================================
// Type descriptors
// ============================================================================

export interface CreateTypeDescriptor {
  readonly kind: 'createType';
  readonly typeName: string;
}

// ============================================================================
// Data transform descriptor
// ============================================================================

export interface DataTransformDescriptor {
  readonly kind: 'dataTransform';
  readonly name: string;
  readonly source: string;
  readonly check: SerializedQueryNode | boolean;
  readonly run: SerializedQueryNode | readonly SerializedQueryNode[];
}

// ============================================================================
// Union type
// ============================================================================

export type MigrationOpDescriptor =
  | CreateTableDescriptor
  | DropTableDescriptor
  | AddColumnDescriptor
  | DropColumnDescriptor
  | AlterColumnTypeDescriptor
  | SetNotNullDescriptor
  | DropNotNullDescriptor
  | SetDefaultDescriptor
  | DropDefaultDescriptor
  | AddPrimaryKeyDescriptor
  | AddUniqueDescriptor
  | AddForeignKeyDescriptor
  | DropConstraintDescriptor
  | CreateIndexDescriptor
  | DropIndexDescriptor
  | CreateTypeDescriptor
  | DataTransformDescriptor;

// ============================================================================
// Builder functions
// ============================================================================

export function createTable(table: string): CreateTableDescriptor {
  return { kind: 'createTable', table };
}

export function dropTable(table: string): DropTableDescriptor {
  return { kind: 'dropTable', table };
}

export function addColumn(table: string, column: string): AddColumnDescriptor {
  return { kind: 'addColumn', table, column };
}

export function dropColumn(table: string, column: string): DropColumnDescriptor {
  return { kind: 'dropColumn', table, column };
}

export function alterColumnType(table: string, column: string): AlterColumnTypeDescriptor {
  return { kind: 'alterColumnType', table, column };
}

export function setNotNull(table: string, column: string): SetNotNullDescriptor {
  return { kind: 'setNotNull', table, column };
}

export function dropNotNull(table: string, column: string): DropNotNullDescriptor {
  return { kind: 'dropNotNull', table, column };
}

export function setDefault(table: string, column: string): SetDefaultDescriptor {
  return { kind: 'setDefault', table, column };
}

export function dropDefault(table: string, column: string): DropDefaultDescriptor {
  return { kind: 'dropDefault', table, column };
}

export function addPrimaryKey(table: string): AddPrimaryKeyDescriptor {
  return { kind: 'addPrimaryKey', table };
}

export function addUnique(table: string, columns: readonly string[]): AddUniqueDescriptor {
  return { kind: 'addUnique', table, columns };
}

export function addForeignKey(table: string, columns: readonly string[]): AddForeignKeyDescriptor {
  return { kind: 'addForeignKey', table, columns };
}

export function dropConstraint(table: string, constraintName: string): DropConstraintDescriptor {
  return { kind: 'dropConstraint', table, constraintName };
}

export function createIndex(table: string, columns: readonly string[]): CreateIndexDescriptor {
  return { kind: 'createIndex', table, columns };
}

export function dropIndex(table: string, indexName: string): DropIndexDescriptor {
  return { kind: 'dropIndex', table, indexName };
}

export function createType(typeName: string): CreateTypeDescriptor {
  return { kind: 'createType', typeName };
}

export function dataTransform(
  name: string,
  options: {
    check: SerializedQueryNode | boolean;
    run: SerializedQueryNode | readonly SerializedQueryNode[];
  },
): DataTransformDescriptor {
  return {
    kind: 'dataTransform',
    name,
    source: 'migration.ts',
    check: options.check,
    run: options.run,
  };
}
