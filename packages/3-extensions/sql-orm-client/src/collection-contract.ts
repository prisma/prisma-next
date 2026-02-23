import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { RelationCardinalityTag } from './types';

interface RelationWithOn {
  readonly to: string;
  readonly cardinality: RelationCardinalityTag | undefined;
  readonly on: {
    readonly parentCols: readonly string[];
    readonly childCols: readonly string[];
  };
}

interface LegacyRelation {
  readonly model: string;
  readonly foreignKey: string;
}

export interface ResolvedIncludeRelation {
  readonly relatedModelName: string;
  readonly relatedTableName: string;
  readonly fkColumn: string;
  readonly parentPkColumn: string;
  readonly cardinality: RelationCardinalityTag | undefined;
}

export function resolveIncludeRelation(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  relationName: string,
): ResolvedIncludeRelation {
  const parentTableName = resolveModelTableName(contract, modelName);
  const relation = resolveContractRelation(contract, parentTableName, relationName);
  if (relation) {
    const relatedTableName = resolveModelTableName(contract, relation.to);
    const parentPkColumn = relation.on.parentCols[0];
    const fkColumn = relation.on.childCols[0];
    if (parentPkColumn && fkColumn) {
      return {
        relatedModelName: relation.to,
        relatedTableName,
        fkColumn,
        parentPkColumn,
        cardinality: relation.cardinality,
      };
    }
  }

  const legacy = resolveLegacyModelRelation(contract, modelName, relationName);
  if (legacy) {
    const parentTable = contract.storage.tables[parentTableName];
    const parentPkColumn = parentTable?.primaryKey?.columns[0] ?? 'id';
    return {
      relatedModelName: legacy.model,
      relatedTableName: resolveModelTableName(contract, legacy.model),
      fkColumn: legacy.foreignKey,
      parentPkColumn,
      cardinality: '1:N',
    };
  }

  throw new Error(`Relation '${relationName}' not found on model '${modelName}'`);
}

function resolveContractRelation(
  contract: SqlContract<SqlStorage>,
  parentTableName: string,
  relationName: string,
): RelationWithOn | undefined {
  const tableRelations = contract.relations as Record<string, Record<string, unknown>>;
  const relation = tableRelations[parentTableName]?.[relationName];
  if (!relation || typeof relation !== 'object') {
    return undefined;
  }

  const relationObj = relation as {
    to?: unknown;
    cardinality?: unknown;
    on?: {
      parentCols?: unknown;
      childCols?: unknown;
    };
  };
  const parentCols = relationObj.on?.parentCols;
  const childCols = relationObj.on?.childCols;

  if (
    typeof relationObj.to !== 'string' ||
    !Array.isArray(parentCols) ||
    !Array.isArray(childCols)
  ) {
    return undefined;
  }

  return {
    to: relationObj.to,
    cardinality: parseRelationCardinality(relationObj.cardinality),
    on: {
      parentCols: parentCols as readonly string[],
      childCols: childCols as readonly string[],
    },
  };
}

function parseRelationCardinality(value: unknown): RelationCardinalityTag | undefined {
  if (value === '1:1' || value === 'N:1' || value === '1:N' || value === 'M:N') {
    return value;
  }
  return undefined;
}

function resolveLegacyModelRelation(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  relationName: string,
): LegacyRelation | undefined {
  const models = contract.models as Record<
    string,
    { relations?: Record<string, { model?: unknown; foreignKey?: unknown }> }
  >;
  const relation = models[modelName]?.relations?.[relationName];
  if (!relation) {
    return undefined;
  }

  if (typeof relation.model !== 'string' || typeof relation.foreignKey !== 'string') {
    return undefined;
  }

  return {
    model: relation.model,
    foreignKey: relation.foreignKey,
  };
}

export function resolveUpsertConflictColumns(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  conflictOn: Record<string, unknown> | undefined,
): string[] {
  const fieldToColumn = contract.mappings.fieldToColumn?.[modelName] ?? {};

  if (conflictOn && typeof conflictOn === 'object') {
    const columns = Object.keys(conflictOn).map(
      (fieldName) => fieldToColumn[fieldName] ?? fieldName,
    );
    if (columns.length > 0) {
      return columns;
    }
  }

  const tableName = resolveModelTableName(contract, modelName);
  const primaryKeyColumns = contract.storage.tables[tableName]?.primaryKey?.columns ?? [];
  return [...primaryKeyColumns];
}

export function resolveModelTableName(
  contract: SqlContract<SqlStorage>,
  modelName: string,
): string {
  const mappedTable = contract.mappings.modelToTable?.[modelName];
  if (mappedTable) {
    return mappedTable;
  }

  const modelStorage = (contract.models as Record<string, { storage?: { table?: unknown } }>)[
    modelName
  ]?.storage;
  if (modelStorage && typeof modelStorage.table === 'string') {
    return modelStorage.table;
  }

  return modelName.toLowerCase();
}

export function resolvePrimaryKeyColumn(
  contract: SqlContract<SqlStorage>,
  tableName: string,
): string {
  return contract.storage.tables[tableName]?.primaryKey?.columns[0] ?? 'id';
}

export function assertReturningCapability(contract: SqlContract<SqlStorage>, action: string): void {
  if (hasContractCapability(contract, 'returning')) {
    return;
  }

  throw new Error(`${action} requires contract capability "returning"`);
}

export function hasContractCapability(
  contract: SqlContract<SqlStorage>,
  capability: string,
): boolean {
  const capabilities = contract.capabilities as Record<string, unknown> | undefined;
  const value = capabilities?.[capability];

  if (value === true) {
    return true;
  }

  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return Object.values(value as Record<string, unknown>).some((flag) => flag === true);
}

export function isToOneCardinality(cardinality: RelationCardinalityTag | undefined): boolean {
  return cardinality === '1:1' || cardinality === 'N:1';
}
