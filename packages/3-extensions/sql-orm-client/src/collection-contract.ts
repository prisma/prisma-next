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

const fieldToColumnCache = new WeakMap<object, Map<string, Record<string, string>>>();
const columnToFieldCache = new WeakMap<object, Map<string, Record<string, string>>>();
const tableToModelCache = new WeakMap<object, Map<string, string | undefined>>();

export function resolveFieldToColumn(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  fieldName: string,
): string {
  return getFieldToColumnMap(contract, modelName)[fieldName] ?? fieldName;
}

export function getFieldToColumnMap(
  contract: SqlContract<SqlStorage>,
  modelName: string,
): Record<string, string> {
  let perContract = fieldToColumnCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    fieldToColumnCache.set(contract, perContract);
  }
  let cached = perContract.get(modelName);
  if (cached) return cached;

  const storageFields = modelsOf(contract)[modelName]?.storage?.fields ?? {};
  cached = {};
  for (const [f, s] of Object.entries(storageFields)) {
    if (s?.column) cached[f] = s.column;
  }
  perContract.set(modelName, cached);
  return cached;
}

export function getColumnToFieldMap(
  contract: SqlContract<SqlStorage>,
  modelName: string,
): Record<string, string> {
  let perContract = columnToFieldCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    columnToFieldCache.set(contract, perContract);
  }
  let cached = perContract.get(modelName);
  if (cached) return cached;

  const storageFields = modelsOf(contract)[modelName]?.storage?.fields ?? {};
  cached = {};
  for (const [f, s] of Object.entries(storageFields)) {
    if (s?.column) cached[s.column] = f;
  }
  perContract.set(modelName, cached);
  return cached;
}

// Assumes 1:1 table→model mapping. When multiple models can share a storage
// table (e.g. owned models), callers should thread modelName directly instead.
export function findModelNameForTable(
  contract: SqlContract<SqlStorage>,
  tableName: string,
): string | undefined {
  let perContract = tableToModelCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    tableToModelCache.set(contract, perContract);
  }
  if (perContract.has(tableName)) return perContract.get(tableName);

  for (const [modelName, model] of Object.entries(modelsOf(contract))) {
    if (model?.storage?.table === tableName) {
      perContract.set(tableName, modelName);
      return modelName;
    }
  }
  perContract.set(tableName, undefined);
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
  readonly targetColumn: string;
  readonly localColumn: string;
  readonly cardinality: RelationCardinalityTag | undefined;
}

export function resolveIncludeRelation(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  relationName: string,
): ResolvedIncludeRelation {
  const relation = resolveModelRelation(contract, modelName, relationName);
  const localField = relation?.on.localFields[0];
  const targetField = relation?.on.targetFields[0];
  if (!relation || !localField || !targetField) {
    throw new Error(`Relation '${relationName}' not found on model '${modelName}'`);
  }

  const relatedTableName = resolveModelTableName(contract, relation.to);
  const localColumn = resolveFieldToColumn(contract, modelName, localField);
  const targetColumn = resolveFieldToColumn(contract, relation.to, targetField);

  return {
    relatedModelName: relation.to,
    relatedTableName,
    targetColumn,
    localColumn,
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

  throw new Error(`Model "${modelName}" is missing storage.table in the contract`);
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
