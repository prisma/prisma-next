import type { SqlForeignKeyIR, SqlTableIR } from '@prisma-next/sql-schema-ir/types';
import { deriveBackRelationFieldName, deriveRelationFieldName } from './name-transforms';
import type { RelationField } from './types';

/**
 * Default referential actions — when the FK uses these, we omit them from the PSL output.
 */
const DEFAULT_ON_DELETE = 'noAction';
const DEFAULT_ON_UPDATE = 'noAction';

/**
 * Maps SqlReferentialAction to PSL-compatible casing.
 */
const REFERENTIAL_ACTION_PSL: Record<string, string> = {
  noAction: 'NoAction',
  restrict: 'Restrict',
  cascade: 'Cascade',
  setNull: 'SetNull',
  setDefault: 'SetDefault',
};

type InferredRelations = {
  /** Relation fields keyed by table name → array of fields to add */
  readonly relationsByTable: ReadonlyMap<string, readonly RelationField[]>;
};

/**
 * Infers relation fields from foreign keys across all tables.
 *
 * For each FK:
 * 1. Creates a relation field on the child table (the table with the FK)
 * 2. Creates a back-relation field on the parent table (the referenced table)
 * 3. Detects 1:1 vs 1:N cardinality
 * 4. Handles multiple FKs to the same parent (named relations)
 * 5. Handles self-referencing FKs
 */
export function inferRelations(
  tables: Record<string, SqlTableIR>,
  modelNameMap: ReadonlyMap<string, string>,
): InferredRelations {
  const relationsByTable = new Map<string, RelationField[]>();

  // Track FK count from each child table to each parent table, for disambiguation
  const fkCountByPair = new Map<string, number>();
  for (const table of Object.values(tables)) {
    for (const fk of table.foreignKeys) {
      const pairKey = `${table.name}→${fk.referencedTable}`;
      fkCountByPair.set(pairKey, (fkCountByPair.get(pairKey) ?? 0) + 1);
    }
  }

  // Track which field names are used per table (including existing columns) for collision avoidance
  const usedFieldNames = new Map<string, Set<string>>();
  for (const table of Object.values(tables)) {
    const names = new Set<string>();
    for (const col of Object.values(table.columns)) {
      names.add(col.name);
    }
    usedFieldNames.set(table.name, names);
  }

  for (const table of Object.values(tables)) {
    for (const fk of table.foreignKeys) {
      const childTableName = table.name;
      const parentTableName = fk.referencedTable;
      const childUsed = usedFieldNames.get(childTableName);
      if (!childUsed) {
        continue;
      }
      const childModelName = modelNameMap.get(childTableName) ?? childTableName;
      const parentModelName = modelNameMap.get(parentTableName) ?? parentTableName;
      const pairKey = `${childTableName}→${parentTableName}`;
      const needsRelationName = (fkCountByPair.get(pairKey) ?? 0) > 1;

      // Determine cardinality
      const isOneToOne = detectOneToOne(fk, table);

      // Derive relation name for disambiguation
      const relationName = needsRelationName ? deriveRelationName(fk) : undefined;

      // Child table: relation field (e.g., author User @relation(...))
      const childRelFieldName = resolveUniqueFieldName(
        deriveRelationFieldName(fk.columns, parentTableName),
        childUsed,
        parentModelName,
      );

      const childRelField = buildChildRelationField(
        childRelFieldName,
        parentModelName,
        fk,
        relationName,
      );

      addRelationField(relationsByTable, childTableName, childRelField);
      childUsed.add(childRelFieldName);

      // Parent table: back-relation field (e.g., posts Post[])
      const parentUsed = usedFieldNames.get(parentTableName) ?? new Set();
      if (!usedFieldNames.has(parentTableName)) {
        usedFieldNames.set(parentTableName, parentUsed);
      }

      const backRelFieldName = resolveUniqueFieldName(
        deriveBackRelationFieldName(childModelName, isOneToOne),
        parentUsed,
        childModelName,
      );

      const backRelField: RelationField = {
        fieldName: backRelFieldName,
        typeName: childModelName,
        optional: isOneToOne,
        list: !isOneToOne,
        relationName,
      };

      addRelationField(relationsByTable, parentTableName, backRelField);
      parentUsed.add(backRelFieldName);
    }
  }

  return { relationsByTable };
}

/**
 * Detects whether a FK represents a 1:1 relationship.
 * A FK is 1:1 if:
 * - The FK columns exactly match the table's PK columns, OR
 * - A single FK column has a unique constraint on it
 */
function detectOneToOne(fk: SqlForeignKeyIR, table: SqlTableIR): boolean {
  // FK columns == PK columns → 1:1
  if (table.primaryKey) {
    const pkCols = [...table.primaryKey.columns].sort();
    const fkCols = [...fk.columns].sort();
    if (pkCols.length === fkCols.length && pkCols.every((c, i) => c === fkCols[i])) {
      return true;
    }
  }

  // Single FK column with a unique constraint → 1:1
  if (fk.columns.length === 1) {
    const [fkCol] = fk.columns;
    if (!fkCol) {
      return false;
    }
    for (const unique of table.uniques) {
      if (unique.columns.length === 1 && unique.columns[0] === fkCol) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Derives a relation name for disambiguation.
 * Uses the FK constraint name if available, otherwise generates from column names.
 */
function deriveRelationName(fk: SqlForeignKeyIR): string {
  if (fk.name) {
    return fk.name;
  }
  return fk.columns.join('_');
}

/**
 * Builds a child-side relation field with @relation attributes.
 */
function buildChildRelationField(
  fieldName: string,
  parentModelName: string,
  fk: SqlForeignKeyIR,
  relationName?: string,
): RelationField {
  const onDelete = fk.onDelete && fk.onDelete !== DEFAULT_ON_DELETE ? fk.onDelete : undefined;
  const onUpdate = fk.onUpdate && fk.onUpdate !== DEFAULT_ON_UPDATE ? fk.onUpdate : undefined;

  return {
    fieldName,
    typeName: parentModelName,
    referencedTableName: fk.referencedTable,
    optional: false,
    list: false,
    relationName,
    fields: fk.columns,
    references: fk.referencedColumns,
    onDelete: onDelete ? REFERENTIAL_ACTION_PSL[onDelete] : undefined,
    onUpdate: onUpdate ? REFERENTIAL_ACTION_PSL[onUpdate] : undefined,
  };
}

/**
 * Resolves a unique field name by appending the model name if there's a collision.
 */
function resolveUniqueFieldName(
  desired: string,
  usedNames: ReadonlySet<string>,
  fallbackSuffix: string,
): string {
  if (!usedNames.has(desired)) {
    return desired;
  }

  // Try appending the model name
  const withSuffix = `${desired}${fallbackSuffix}`;
  if (!usedNames.has(withSuffix)) {
    return withSuffix;
  }

  // Last resort: append a number
  let counter = 2;
  while (usedNames.has(`${desired}${counter}`)) {
    counter++;
  }
  return `${desired}${counter}`;
}

function addRelationField(
  map: Map<string, RelationField[]>,
  tableName: string,
  field: RelationField,
): void {
  const existing = map.get(tableName);
  if (existing) {
    existing.push(field);
  } else {
    map.set(tableName, [field]);
  }
}
