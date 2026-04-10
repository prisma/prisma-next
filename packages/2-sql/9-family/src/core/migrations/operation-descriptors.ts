/**
 * SQL migration operation descriptors — builder functions and re-exports.
 *
 * Types are defined by arktype schemas in descriptor-schemas.ts and derived
 * via `typeof schema.infer`. This file provides the builder functions that
 * construct descriptors, plus re-exports the types and schemas.
 */

import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { ifDefined } from '@prisma-next/utils/defined';

// Re-export types and schemas from the schema source of truth
export type {
  AddColumnDescriptor,
  AddEnumValuesDescriptor,
  AddForeignKeyDescriptor,
  AddPrimaryKeyDescriptor,
  AddUniqueDescriptor,
  AlterColumnTypeDescriptor,
  CreateDependencyDescriptor,
  CreateEnumTypeDescriptor,
  CreateIndexDescriptor,
  CreateTableDescriptor,
  DataTransformDescriptor,
  DropColumnDescriptor,
  DropConstraintDescriptor,
  DropDefaultDescriptor,
  DropEnumTypeDescriptor,
  DropIndexDescriptor,
  DropNotNullDescriptor,
  DropTableDescriptor,
  RenameTypeDescriptor,
  SetDefaultDescriptor,
  SetNotNullDescriptor,
  SqlMigrationOpDescriptor,
} from './descriptor-schemas';

export { MigrationDescriptorArraySchema } from './descriptor-schemas';

import type {
  AddColumnDescriptor,
  AddEnumValuesDescriptor,
  AddForeignKeyDescriptor,
  AddPrimaryKeyDescriptor,
  AddUniqueDescriptor,
  AlterColumnTypeDescriptor,
  CreateDependencyDescriptor,
  CreateEnumTypeDescriptor,
  CreateIndexDescriptor,
  CreateTableDescriptor,
  DropColumnDescriptor,
  DropConstraintDescriptor,
  DropDefaultDescriptor,
  DropEnumTypeDescriptor,
  DropIndexDescriptor,
  DropNotNullDescriptor,
  DropTableDescriptor,
  RenameTypeDescriptor,
  SetDefaultDescriptor,
  SetNotNullDescriptor,
} from './descriptor-schemas';

// ============================================================================
// Data transform support types (not validated by arktype — runtime values)
// ============================================================================

/** Something that can produce a SqlQueryPlan via .build(). */
export interface Buildable {
  build(): SqlQueryPlan;
}

/**
 * Sentinel value for unimplemented data transform queries.
 * The scaffold renders this as a TODO comment. The resolver throws if it encounters one.
 */
export const TODO = Symbol.for('prisma-next.migration.todo');
export type TodoMarker = typeof TODO;

// ============================================================================
// Builder functions
// ============================================================================

export function createTable(table: string): CreateTableDescriptor {
  return { kind: 'createTable', table };
}

export function dropTable(table: string): DropTableDescriptor {
  return { kind: 'dropTable', table };
}

export function addColumn(
  table: string,
  column: string,
  overrides?: { nullable?: boolean },
): AddColumnDescriptor {
  return { kind: 'addColumn', table, column, ...ifDefined('overrides', overrides) };
}

export function dropColumn(table: string, column: string): DropColumnDescriptor {
  return { kind: 'dropColumn', table, column };
}

export function alterColumnType(
  table: string,
  column: string,
  opts?: string | { using?: string; toType?: string },
): AlterColumnTypeDescriptor {
  const using = typeof opts === 'string' ? opts : opts?.using;
  const toType = typeof opts === 'string' ? undefined : opts?.toType;
  return {
    kind: 'alterColumnType',
    table,
    column,
    ...ifDefined('using', using),
    ...ifDefined('toType', toType),
  };
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
  return { kind: 'addUnique', table, columns: [...columns] };
}

export function addForeignKey(table: string, columns: readonly string[]): AddForeignKeyDescriptor {
  return { kind: 'addForeignKey', table, columns: [...columns] };
}

export function dropConstraint(table: string, constraintName: string): DropConstraintDescriptor {
  return { kind: 'dropConstraint', table, constraintName };
}

export function createIndex(table: string, columns: readonly string[]): CreateIndexDescriptor {
  return { kind: 'createIndex', table, columns: [...columns] };
}

export function dropIndex(table: string, indexName: string): DropIndexDescriptor {
  return { kind: 'dropIndex', table, indexName };
}

export function createEnumType(
  typeName: string,
  values?: readonly string[],
): CreateEnumTypeDescriptor {
  return {
    kind: 'createEnumType',
    typeName,
    ...ifDefined('values', values ? [...values] : undefined),
  };
}

export function addEnumValues(
  typeName: string,
  values: readonly string[],
): AddEnumValuesDescriptor {
  return { kind: 'addEnumValues', typeName, values: [...values] };
}

export function dropEnumType(typeName: string): DropEnumTypeDescriptor {
  return { kind: 'dropEnumType', typeName };
}

export function renameType(fromName: string, toName: string): RenameTypeDescriptor {
  return { kind: 'renameType', fromName, toName };
}

export function createDependency(dependencyId: string): CreateDependencyDescriptor {
  return { kind: 'createDependency', dependencyId };
}

/**
 * All structural builder functions keyed by descriptor kind.
 */
export const builders = {
  createTable,
  dropTable,
  addColumn,
  dropColumn,
  alterColumnType,
  setNotNull,
  dropNotNull,
  setDefault,
  dropDefault,
  addPrimaryKey,
  addUnique,
  addForeignKey,
  dropConstraint,
  createIndex,
  dropIndex,
  createEnumType,
  addEnumValues,
  dropEnumType,
  renameType,
  createDependency,
} as const;
