import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { RelationCardinalityTag } from './types';

type ModelStorageFields = Record<string, { column?: string }>;
type ModelEntry = {
  storage?: { table?: string; fields?: ModelStorageFields };
  relations?: Record<string, unknown>;
  fields?: Record<string, { codecId?: string }>;
};
type ModelsMap = Record<string, ModelEntry>;

function modelsOf(contract: Contract<SqlStorage>): ModelsMap {
  return contract.models as ModelsMap;
}

export function modelOf(contract: Contract<SqlStorage>, name: string): ModelEntry | undefined {
  return modelsOf(contract)[name];
}

const fieldToColumnCache = new WeakMap<object, Map<string, Record<string, string>>>();
const columnToFieldCache = new WeakMap<object, Map<string, Record<string, string>>>();
const tableToModelCache = new WeakMap<object, Map<string, string>>();

export function resolveFieldToColumn(
  contract: Contract<SqlStorage>,
  modelName: string,
  fieldName: string,
): string {
  return getFieldToColumnMap(contract, modelName)[fieldName] ?? fieldName;
}

export function getFieldToColumnMap(
  contract: Contract<SqlStorage>,
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
  contract: Contract<SqlStorage>,
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
  contract: Contract<SqlStorage>,
  tableName: string,
): string | undefined {
  let reverseMap = tableToModelCache.get(contract);
  if (!reverseMap) {
    reverseMap = new Map();
    for (const [modelName, model] of Object.entries(modelsOf(contract))) {
      const table = model?.storage?.table;
      if (table) reverseMap.set(table, modelName);
    }
    tableToModelCache.set(contract, reverseMap);
  }
  return reverseMap.get(tableName);
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
  contract: Contract<SqlStorage>,
  modelName: string,
  relationName: string,
): ResolvedIncludeRelation {
  const relations = resolveModelRelations(contract, modelName);
  const relation = relations[relationName];
  if (!relation) {
    throw new Error(`Relation '${relationName}' not found on model '${modelName}'`);
  }
  const localField = relation.on.localFields[0];
  const targetField = relation.on.targetFields[0];
  if (!localField || !targetField) {
    throw new Error(
      `Relation '${relationName}' on model '${modelName}' has incomplete join metadata (missing localFields or targetFields)`,
    );
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

const modelRelationsCache = new WeakMap<object, Map<string, Record<string, ResolvedRelation>>>();

export function resolveModelRelations(
  contract: Contract<SqlStorage>,
  modelName: string,
): Record<string, ResolvedRelation> {
  let perContract = modelRelationsCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    modelRelationsCache.set(contract, perContract);
  }
  const cached = perContract.get(modelName);
  if (cached) return cached;

  const models = modelsOf(contract);
  const relationMap = models[modelName]?.relations ?? {};
  const resolved: Record<string, ResolvedRelation> = {};

  for (const [name, value] of Object.entries(relationMap)) {
    if (!value || typeof value !== 'object') continue;

    const rel = value as {
      to?: unknown;
      cardinality?: unknown;
      on?: { localFields?: unknown; targetFields?: unknown };
    };
    const localFields = rel.on?.localFields;
    const targetFields = rel.on?.targetFields;

    if (typeof rel.to !== 'string' || !Array.isArray(localFields) || !Array.isArray(targetFields)) {
      continue;
    }

    resolved[name] = {
      to: rel.to,
      cardinality: parseRelationCardinality(rel.cardinality),
      on: {
        localFields: localFields as readonly string[],
        targetFields: targetFields as readonly string[],
      },
    };
  }

  perContract.set(modelName, resolved);
  return resolved;
}

export function parseRelationCardinality(value: unknown): RelationCardinalityTag | undefined {
  if (value === '1:1' || value === 'N:1' || value === '1:N' || value === 'M:N') {
    return value;
  }
  return undefined;
}

export function resolveUpsertConflictColumns(
  contract: Contract<SqlStorage>,
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

export function resolveModelTableName(contract: Contract<SqlStorage>, modelName: string): string {
  const model = modelsOf(contract)[modelName];
  if (!model) {
    throw new Error(`Model "${modelName}" not found in contract`);
  }
  if (model.storage && typeof model.storage.table === 'string') {
    return model.storage.table;
  }
  throw new Error(`Model "${modelName}" has invalid or missing storage.table in the contract`);
}

export function resolvePrimaryKeyColumn(contract: Contract<SqlStorage>, tableName: string): string {
  return contract.storage.tables[tableName]?.primaryKey?.columns[0] ?? 'id';
}

export function assertReturningCapability(contract: Contract<SqlStorage>, action: string): void {
  if (hasContractCapability(contract, 'returning')) {
    return;
  }

  throw new Error(`${action} requires contract capability "returning"`);
}

export function hasContractCapability(contract: Contract<SqlStorage>, capability: string): boolean {
  const capabilities = contract.capabilities;
  const value = capabilities[capability];

  if (capabilityEnabled(value)) {
    return true;
  }

  return Object.values(capabilities).some((targetCapabilities) => {
    if (typeof targetCapabilities !== 'object' || targetCapabilities === null) {
      return false;
    }
    return capabilityEnabled(targetCapabilities[capability]);
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
