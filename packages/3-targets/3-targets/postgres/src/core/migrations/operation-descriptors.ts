/**
 * Thin operation descriptors for the migration authoring API.
 *
 * These are pure data — no SQL, no codec resolution, no contract types.
 * Users construct them via ergonomic builder functions (addColumn, dropColumn, etc.).
 * At verification time, a resolver converts them to SqlMigrationPlanOperation
 * using the full contract context (codec hooks, schema name, etc.).
 */

// ============================================================================
// Table descriptors
// ============================================================================

export interface CreateTableDescriptor {
  readonly kind: 'createTable';
  readonly table: string;
  readonly columns: Readonly<Record<string, ColumnSpec>>;
  readonly primaryKey?: readonly string[];
}

export interface DropTableDescriptor {
  readonly kind: 'dropTable';
  readonly table: string;
}

// ============================================================================
// Column descriptors
// ============================================================================

export interface ColumnSpec {
  readonly type: string;
  readonly nullable?: boolean;
  readonly default?: string;
}

export interface AddColumnDescriptor {
  readonly kind: 'addColumn';
  readonly table: string;
  readonly column: string;
  readonly type: string;
  readonly nullable?: boolean;
  readonly default?: string;
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
  readonly newType: string;
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
  readonly default: string;
}

export interface DropDefaultDescriptor {
  readonly kind: 'dropDefault';
  readonly table: string;
  readonly column: string;
}

// ============================================================================
// Constraint descriptors
// ============================================================================

export interface AddPrimaryKeyDescriptor {
  readonly kind: 'addPrimaryKey';
  readonly table: string;
  readonly columns: readonly string[];
  readonly constraintName?: string;
}

export interface AddUniqueDescriptor {
  readonly kind: 'addUnique';
  readonly table: string;
  readonly columns: readonly string[];
  readonly constraintName?: string;
}

export interface AddForeignKeyDescriptor {
  readonly kind: 'addForeignKey';
  readonly table: string;
  readonly columns: readonly string[];
  readonly references: {
    readonly table: string;
    readonly columns: readonly string[];
  };
  readonly onDelete?: string;
  readonly onUpdate?: string;
  readonly constraintName?: string;
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
  readonly indexName?: string;
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
  readonly check: unknown;
  readonly run: unknown;
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
// Builder functions (produce descriptors)
// ============================================================================

export function createTable(
  table: string,
  options: { columns: Readonly<Record<string, ColumnSpec>>; primaryKey?: readonly string[] },
): CreateTableDescriptor {
  const base = { kind: 'createTable' as const, table, columns: options.columns };
  return options.primaryKey ? { ...base, primaryKey: options.primaryKey } : base;
}

export function dropTable(table: string): DropTableDescriptor {
  return { kind: 'dropTable', table };
}

export function addColumn(
  table: string,
  column: string,
  options: { type: string; nullable?: boolean; default?: string },
): AddColumnDescriptor {
  const base: AddColumnDescriptor = { kind: 'addColumn', table, column, type: options.type };
  if (options.nullable !== undefined) return { ...base, nullable: options.nullable };
  if (options.default !== undefined) return { ...base, default: options.default };
  if (options.nullable !== undefined && options.default !== undefined)
    return { ...base, nullable: options.nullable, default: options.default };
  return base;
}

export function dropColumn(table: string, column: string): DropColumnDescriptor {
  return { kind: 'dropColumn', table, column };
}

export function alterColumnType(
  table: string,
  column: string,
  newType: string,
): AlterColumnTypeDescriptor {
  return { kind: 'alterColumnType', table, column, newType };
}

export function setNotNull(table: string, column: string): SetNotNullDescriptor {
  return { kind: 'setNotNull', table, column };
}

export function dropNotNull(table: string, column: string): DropNotNullDescriptor {
  return { kind: 'dropNotNull', table, column };
}

export function setDefault(
  table: string,
  column: string,
  defaultValue: string,
): SetDefaultDescriptor {
  return { kind: 'setDefault', table, column, default: defaultValue };
}

export function dropDefault(table: string, column: string): DropDefaultDescriptor {
  return { kind: 'dropDefault', table, column };
}

export function addPrimaryKey(
  table: string,
  options: { columns: readonly string[]; constraintName?: string },
): AddPrimaryKeyDescriptor {
  const base = { kind: 'addPrimaryKey' as const, table, columns: options.columns };
  return options.constraintName ? { ...base, constraintName: options.constraintName } : base;
}

export function addUnique(
  table: string,
  options: { columns: readonly string[]; constraintName?: string },
): AddUniqueDescriptor {
  const base = { kind: 'addUnique' as const, table, columns: options.columns };
  return options.constraintName ? { ...base, constraintName: options.constraintName } : base;
}

export function addForeignKey(
  table: string,
  options: {
    columns: readonly string[];
    references: { table: string; columns: readonly string[] };
    onDelete?: string;
    onUpdate?: string;
    constraintName?: string;
  },
): AddForeignKeyDescriptor {
  const base = {
    kind: 'addForeignKey' as const,
    table,
    columns: options.columns,
    references: options.references,
  };
  const withOnDelete = options.onDelete ? { ...base, onDelete: options.onDelete } : base;
  const withOnUpdate = options.onUpdate
    ? { ...withOnDelete, onUpdate: options.onUpdate }
    : withOnDelete;
  return options.constraintName
    ? { ...withOnUpdate, constraintName: options.constraintName }
    : withOnUpdate;
}

export function dropConstraint(table: string, constraintName: string): DropConstraintDescriptor {
  return { kind: 'dropConstraint', table, constraintName };
}

export function createIndex(
  table: string,
  options: { columns: readonly string[]; indexName?: string },
): CreateIndexDescriptor {
  const base = { kind: 'createIndex' as const, table, columns: options.columns };
  return options.indexName ? { ...base, indexName: options.indexName } : base;
}

export function dropIndex(table: string, indexName: string): DropIndexDescriptor {
  return { kind: 'dropIndex', table, indexName };
}

export function createType(typeName: string): CreateTypeDescriptor {
  return { kind: 'createType', typeName };
}

export function dataTransform(
  name: string,
  options: { check: unknown; run: unknown },
): DataTransformDescriptor {
  return {
    kind: 'dataTransform',
    name,
    source: 'migration.ts',
    check: options.check,
    run: options.run,
  };
}
