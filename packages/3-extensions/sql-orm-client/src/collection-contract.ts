import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { RelationCardinalityTag } from './types';

type ModelStorageFields = Record<string, { column?: string }>;
type ModelEntry = {
  storage?: { table?: string; fields?: ModelStorageFields };
  relations?: Record<string, unknown>;
  fields?: Record<string, { codecId?: string }>;
};
type ModelsMap = Record<string, ModelEntry>;

function modelsOf(contract: SqlContract<SqlStorage>): ModelsMap {
  return contract.models as ModelsMap;
}

export function resolveFieldToColumn(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  fieldName: string,
): string {
  return modelsOf(contract)[modelName]?.storage?.fields?.[fieldName]?.column ?? fieldName;
}

export function getFieldToColumnMap(
  contract: SqlContract<SqlStorage>,
  modelName: string,
): Record<string, string> {
  const storageFields = modelsOf(contract)[modelName]?.storage?.fields ?? {};
  const result: Record<string, string> = {};
  for (const [f, s] of Object.entries(storageFields)) {
    if (s?.column) result[f] = s.column;
  }
  return result;
}

export function getColumnToFieldMap(
  contract: SqlContract<SqlStorage>,
  modelName: string,
): Record<string, string> {
  const storageFields = modelsOf(contract)[modelName]?.storage?.fields ?? {};
  const result: Record<string, string> = {};
  for (const [f, s] of Object.entries(storageFields)) {
    if (s?.column) result[s.column] = f;
  }
  return result;
}

export function findModelNameForTable(
  contract: SqlContract<SqlStorage>,
  tableName: string,
): string | undefined {
  for (const [modelName, model] of Object.entries(modelsOf(contract))) {
    if (model?.storage?.table === tableName) {
      return modelName;
    }
  }
  return undefined;
}

interface ResolvedRelation {
  readonly to: string;
  readonly cardinality: RelationCardinalityTag | undefined;
  readonly on: {
    readonly localFields: readonly string[];
    readonly targetFields: readonly string[];
  };
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
  const relation = resolveModelRelation(contract, modelName, relationName);
  if (!relation) {
    throw new Error(`Relation '${relationName}' not found on model '${modelName}'`);
  }

  const relatedTableName = resolveModelTableName(contract, relation.to);

  const localColumn = resolveFieldToColumn(contract, modelName, relation.on.localFields[0] ?? '');
  const targetColumn = resolveFieldToColumn(
    contract,
    relation.to,
    relation.on.targetFields[0] ?? '',
  );

  return {
    relatedModelName: relation.to,
    relatedTableName,
    fkColumn: targetColumn,
    parentPkColumn: localColumn,
    cardinality: relation.cardinality,
  };
}

function resolveModelRelation(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  relationName: string,
): ResolvedRelation | undefined {
  const models = modelsOf(contract);
  const relation = models[modelName]?.relations?.[relationName];
  if (!relation || typeof relation !== 'object') {
    return undefined;
  }

  const relationObj = relation as {
    to?: unknown;
    cardinality?: unknown;
    on?: {
      localFields?: unknown;
      targetFields?: unknown;
    };
  };
  const localFields = relationObj.on?.localFields;
  const targetFields = relationObj.on?.targetFields;

  if (
    typeof relationObj.to !== 'string' ||
    !Array.isArray(localFields) ||
    !Array.isArray(targetFields)
  ) {
    return undefined;
  }

  return {
    to: relationObj.to,
    cardinality: parseRelationCardinality(relationObj.cardinality),
    on: {
      localFields: localFields as readonly string[],
      targetFields: targetFields as readonly string[],
    },
  };
}

function parseRelationCardinality(value: unknown): RelationCardinalityTag | undefined {
  if (value === '1:1' || value === 'N:1' || value === '1:N' || value === 'M:N') {
    return value;
  }
  return undefined;
}

export function resolveUpsertConflictColumns(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  conflictOn: Record<string, unknown> | undefined,
): string[] {
  if (conflictOn && typeof conflictOn === 'object') {
    const columns = Object.keys(conflictOn).map((fieldName) =>
      resolveFieldToColumn(contract, modelName, fieldName),
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
  const modelStorage = modelsOf(contract)[modelName]?.storage;
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

  if (capabilityEnabled(value)) {
    return true;
  }

  if (!capabilities) {
    return false;
  }

  return Object.values(capabilities).some((targetCapabilities) => {
    if (typeof targetCapabilities !== 'object' || targetCapabilities === null) {
      return false;
    }
    return capabilityEnabled((targetCapabilities as Record<string, unknown>)[capability]);
  });
}

function capabilityEnabled(value: unknown): boolean {
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
