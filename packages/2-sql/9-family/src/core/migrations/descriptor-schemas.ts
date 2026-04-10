/**
 * Arktype schemas for SQL migration operation descriptors.
 *
 * These schemas are the source of truth for descriptor shapes.
 * TypeScript types are derived via `typeof schema.infer`.
 */

import { type } from 'arktype';

// ============================================================================
// Table descriptors
// ============================================================================

export const CreateTableSchema = type({ kind: "'createTable'", table: 'string' });
export const DropTableSchema = type({ kind: "'dropTable'", table: 'string' });

// ============================================================================
// Column descriptors
// ============================================================================

export const AddColumnSchema = type({
  kind: "'addColumn'",
  table: 'string',
  column: 'string',
  'overrides?': { 'nullable?': 'boolean' },
});

export const DropColumnSchema = type({ kind: "'dropColumn'", table: 'string', column: 'string' });

export const AlterColumnTypeSchema = type({
  kind: "'alterColumnType'",
  table: 'string',
  column: 'string',
  'using?': 'string',
  'toType?': 'string',
});

export const SetNotNullSchema = type({ kind: "'setNotNull'", table: 'string', column: 'string' });
export const DropNotNullSchema = type({ kind: "'dropNotNull'", table: 'string', column: 'string' });
export const SetDefaultSchema = type({ kind: "'setDefault'", table: 'string', column: 'string' });
export const DropDefaultSchema = type({ kind: "'dropDefault'", table: 'string', column: 'string' });

// ============================================================================
// Constraint descriptors
// ============================================================================

export const AddPrimaryKeySchema = type({ kind: "'addPrimaryKey'", table: 'string' });
export const AddUniqueSchema = type({ kind: "'addUnique'", table: 'string', columns: 'string[]' });
export const AddForeignKeySchema = type({
  kind: "'addForeignKey'",
  table: 'string',
  columns: 'string[]',
});
export const DropConstraintSchema = type({
  kind: "'dropConstraint'",
  table: 'string',
  constraintName: 'string',
});

// ============================================================================
// Index descriptors
// ============================================================================

export const CreateIndexSchema = type({
  kind: "'createIndex'",
  table: 'string',
  columns: 'string[]',
});
export const DropIndexSchema = type({
  kind: "'dropIndex'",
  table: 'string',
  indexName: 'string',
});

// ============================================================================
// Type descriptors
// ============================================================================

export const CreateEnumTypeSchema = type({
  kind: "'createEnumType'",
  typeName: 'string',
  'values?': 'string[]',
});
export const AddEnumValuesSchema = type({
  kind: "'addEnumValues'",
  typeName: 'string',
  values: 'string[]',
});
export const DropEnumTypeSchema = type({ kind: "'dropEnumType'", typeName: 'string' });
export const RenameTypeSchema = type({
  kind: "'renameType'",
  fromName: 'string',
  toName: 'string',
});

// ============================================================================
// Dependency descriptors
// ============================================================================

export const CreateDependencySchema = type({
  kind: "'createDependency'",
  dependencyId: 'string',
});

// ============================================================================
// Data transform descriptor
// ============================================================================

export const DataTransformSchema = type({
  kind: "'dataTransform'",
  name: 'string',
  source: 'string',
  check: 'boolean | Function | symbol | object',
  run: '(Function | symbol | object)[]',
});

// ============================================================================
// Union schema
// ============================================================================

export const SqlMigrationOpDescriptorSchema = type.or(
  CreateTableSchema,
  DropTableSchema,
  AddColumnSchema,
  DropColumnSchema,
  AlterColumnTypeSchema,
  SetNotNullSchema,
  DropNotNullSchema,
  SetDefaultSchema,
  DropDefaultSchema,
  AddPrimaryKeySchema,
  AddUniqueSchema,
  AddForeignKeySchema,
  DropConstraintSchema,
  CreateIndexSchema,
  DropIndexSchema,
  CreateEnumTypeSchema,
  AddEnumValuesSchema,
  DropEnumTypeSchema,
  RenameTypeSchema,
  CreateDependencySchema,
  DataTransformSchema,
);

export const MigrationDescriptorArraySchema = SqlMigrationOpDescriptorSchema.array();

// ============================================================================
// Derived types
// ============================================================================

export type CreateTableDescriptor = typeof CreateTableSchema.infer;
export type DropTableDescriptor = typeof DropTableSchema.infer;
export type AddColumnDescriptor = typeof AddColumnSchema.infer;
export type DropColumnDescriptor = typeof DropColumnSchema.infer;
export type AlterColumnTypeDescriptor = typeof AlterColumnTypeSchema.infer;
export type SetNotNullDescriptor = typeof SetNotNullSchema.infer;
export type DropNotNullDescriptor = typeof DropNotNullSchema.infer;
export type SetDefaultDescriptor = typeof SetDefaultSchema.infer;
export type DropDefaultDescriptor = typeof DropDefaultSchema.infer;
export type AddPrimaryKeyDescriptor = typeof AddPrimaryKeySchema.infer;
export type AddUniqueDescriptor = typeof AddUniqueSchema.infer;
export type AddForeignKeyDescriptor = typeof AddForeignKeySchema.infer;
export type DropConstraintDescriptor = typeof DropConstraintSchema.infer;
export type CreateIndexDescriptor = typeof CreateIndexSchema.infer;
export type DropIndexDescriptor = typeof DropIndexSchema.infer;
export type CreateEnumTypeDescriptor = typeof CreateEnumTypeSchema.infer;
export type AddEnumValuesDescriptor = typeof AddEnumValuesSchema.infer;
export type DropEnumTypeDescriptor = typeof DropEnumTypeSchema.infer;
export type RenameTypeDescriptor = typeof RenameTypeSchema.infer;
export type CreateDependencyDescriptor = typeof CreateDependencySchema.infer;
export type DataTransformDescriptor = typeof DataTransformSchema.infer;
export type SqlMigrationOpDescriptor = typeof SqlMigrationOpDescriptorSchema.infer;
