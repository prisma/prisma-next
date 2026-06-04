import {
  type Contract,
  type ContractFieldType,
  type ContractRelationThrough,
  type CrossReference,
  domainModelsAtDefaultNamespace,
} from '@prisma-next/contract/types';
import type { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import {
  domainModelTableInNamespace,
  resolveDomainModelForContract,
  resolveTableForContract,
  storageTableForContract,
} from './storage-resolution';
import type { RelationCardinalityTag } from './types';

type ModelStorageFields = Record<string, { column?: string }>;
type ModelEntry = {
  storage?: { table?: string; fields?: ModelStorageFields };
  relations?: Record<string, unknown>;
  fields?: Record<string, { type?: ContractFieldType }>;
  discriminator?: { field: string };
  variants?: Record<string, { value: string }>;
  base?: CrossReference;
};
type ModelsMap = Record<string, ModelEntry>;

export interface PolymorphismVariantInfo {
  readonly modelName: string;
  readonly value: string;
  readonly table: string;
  readonly strategy: 'sti' | 'mti';
}

export interface PolymorphismInfo {
  readonly discriminatorField: string;
  readonly discriminatorColumn: string;
  readonly baseTable: string;
  readonly variants: ReadonlyMap<string, PolymorphismVariantInfo>;
  readonly variantsByValue: ReadonlyMap<string, PolymorphismVariantInfo>;
  readonly mtiVariants: readonly PolymorphismVariantInfo[];
}

// Model map for a model's metadata resolution. When a namespace coordinate is
// supplied the lookup is scoped to that namespace (`orm.<ns>.<Model>`); without
// one it falls back to the sole-namespace map, which still throws on a
// multi-namespace contract because bare-name access is ambiguous there.
function modelsOf(contract: Contract<SqlStorage>, namespaceId?: string): ModelsMap {
  if (namespaceId === undefined) {
    return domainModelsAtDefaultNamespace(contract.domain) as ModelsMap;
  }
  const namespace = contract.domain.namespaces[namespaceId];
  if (namespace === undefined) {
    throw new Error(`domain namespace "${namespaceId}" is not present on the contract`);
  }
  return blindCast<ModelsMap, 'domain namespace models are model entries for this SQL contract'>(
    namespace.models,
  );
}

function metadataCacheKey(modelName: string, namespaceId?: string): string {
  return namespaceId === undefined ? modelName : `${namespaceId}\u0000${modelName}`;
}

export function modelOf(
  contract: Contract<SqlStorage>,
  name: string,
  namespaceId?: string,
): ModelEntry | undefined {
  if (namespaceId !== undefined) {
    const model = contract.domain.namespaces[namespaceId]?.models[name];
    return model === undefined
      ? undefined
      : blindCast<ModelEntry, 'domain namespace model is a model entry for this SQL contract'>(
          model,
        );
  }
  const resolved = resolveDomainModelForContract(contract, name);
  return resolved?.model as ModelEntry | undefined;
}

const fieldToColumnCache = new WeakMap<object, Map<string, Record<string, string>>>();
const columnToFieldCache = new WeakMap<object, Map<string, Record<string, string>>>();
const polymorphismCache = new WeakMap<object, Map<string, PolymorphismInfo | undefined>>();

export function resolvePolymorphismInfo(
  contract: Contract<SqlStorage>,
  modelName: string,
  namespaceId?: string,
): PolymorphismInfo | undefined {
  let perContract = polymorphismCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    polymorphismCache.set(contract, perContract);
  }
  const cacheKey = metadataCacheKey(modelName, namespaceId);
  if (perContract.has(cacheKey)) return perContract.get(cacheKey);

  const models = modelsOf(contract, namespaceId);
  const model = models[modelName];
  if (!model?.discriminator || !model.variants) {
    perContract.set(cacheKey, undefined);
    return undefined;
  }

  const baseTable = model.storage?.table;
  if (!baseTable) {
    perContract.set(cacheKey, undefined);
    return undefined;
  }

  const discriminatorField = model.discriminator.field;
  const discriminatorColumn = resolveFieldToColumn(
    contract,
    modelName,
    discriminatorField,
    namespaceId,
  );

  const variants = new Map<string, PolymorphismVariantInfo>();
  const variantsByValue = new Map<string, PolymorphismVariantInfo>();
  const mtiVariants: PolymorphismVariantInfo[] = [];

  for (const [variantModelName, variantEntry] of Object.entries(model.variants)) {
    const variantModel = models[variantModelName];
    if (!variantModel) {
      throw new Error(
        `Model "${modelName}" declares variant "${variantModelName}", but that model is missing from the contract`,
      );
    }
    const variantTable = variantModel.storage?.table ?? baseTable;
    const strategy = variantTable === baseTable ? 'sti' : 'mti';

    const info: PolymorphismVariantInfo = {
      modelName: variantModelName,
      value: variantEntry.value,
      table: variantTable,
      strategy,
    };

    variants.set(variantModelName, info);
    variantsByValue.set(variantEntry.value, info);
    if (strategy === 'mti') {
      mtiVariants.push(info);
    }
  }

  const result: PolymorphismInfo = {
    discriminatorField,
    discriminatorColumn,
    baseTable,
    variants,
    variantsByValue,
    mtiVariants,
  };

  perContract.set(cacheKey, result);
  return result;
}

export function resolveFieldToColumn(
  contract: Contract<SqlStorage>,
  modelName: string,
  fieldName: string,
  namespaceId?: string,
): string {
  return getFieldToColumnMap(contract, modelName, namespaceId)[fieldName] ?? fieldName;
}

export interface VariantColumnRef {
  // Bare storage-table name (namespace-flat, like every table name in this
  // module). The namespace is bound separately when the name becomes a
  // `TableSource` via `tableSourceForContract`/`requireStorageTableForContract`.
  readonly table: string;
  readonly column: string;
}

/**
 * Map the fields that an MTI variant contributes to `{ table, column }` refs
 * qualified against the variant's own table — the table the read path joins
 * into the correlated child SELECT. STI variants contribute nothing here:
 * their columns live on the base table and resolve through the ordinary
 * base-table field map. Base fields are intentionally absent so callers can
 * gate variant qualification strictly to variant-owned fields.
 *
 * `baseModelName` is a default-namespace model name, consistent with the rest
 * of this module; namespace context is bound downstream at table resolution.
 *
 * Uncached on purpose: `resolvePolymorphismInfo` already memoizes the variant
 * lookup, and the remaining work is one pass over the variant's field→column
 * map, so a second cache layer would buy nothing.
 */
export function resolveVariantFieldColumns(
  contract: Contract<SqlStorage>,
  baseModelName: string,
  variantName: string,
): Record<string, VariantColumnRef> {
  const polyInfo = resolvePolymorphismInfo(contract, baseModelName);
  const variant = polyInfo?.variants.get(variantName);
  const result: Record<string, VariantColumnRef> = {};

  if (variant && variant.strategy === 'mti') {
    const variantFieldToColumn = getFieldToColumnMap(contract, variant.modelName);
    for (const [field, column] of Object.entries(variantFieldToColumn)) {
      result[field] = { table: variant.table, column };
    }
  }

  return result;
}

export function getFieldToColumnMap(
  contract: Contract<SqlStorage>,
  modelName: string,
  namespaceId?: string,
): Record<string, string> {
  let perContract = fieldToColumnCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    fieldToColumnCache.set(contract, perContract);
  }
  const cacheKey = metadataCacheKey(modelName, namespaceId);
  let cached = perContract.get(cacheKey);
  if (cached) return cached;

  const storageFields = modelsOf(contract, namespaceId)[modelName]?.storage?.fields ?? {};
  cached = {};
  for (const [f, s] of Object.entries(storageFields)) {
    if (s?.column) cached[f] = s.column;
  }
  perContract.set(cacheKey, cached);
  return cached;
}

export function getColumnToFieldMap(
  contract: Contract<SqlStorage>,
  modelName: string,
  namespaceId?: string,
): Record<string, string> {
  let perContract = columnToFieldCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    columnToFieldCache.set(contract, perContract);
  }
  const cacheKey = metadataCacheKey(modelName, namespaceId);
  let cached = perContract.get(cacheKey);
  if (cached) return cached;

  const storageFields = modelsOf(contract, namespaceId)[modelName]?.storage?.fields ?? {};
  cached = {};
  for (const [f, s] of Object.entries(storageFields)) {
    if (s?.column) cached[s.column] = f;
  }
  perContract.set(cacheKey, cached);
  return cached;
}

const completeColumnToFieldCache = new WeakMap<object, Map<string, Record<string, string>>>();

/**
 * Like getColumnToFieldMap but includes identity-mapped fields (where field name equals column
 * name). getColumnToFieldMap only returns explicit remaps; this returns ALL column→field entries.
 */
export function getCompleteColumnToFieldMap(
  contract: Contract<SqlStorage>,
  modelName: string,
  namespaceId?: string,
): Record<string, string> {
  let perContract = completeColumnToFieldCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    completeColumnToFieldCache.set(contract, perContract);
  }
  const cacheKey = metadataCacheKey(modelName, namespaceId);
  let cached = perContract.get(cacheKey);
  if (cached) return cached;

  const storageFields = modelsOf(contract, namespaceId)[modelName]?.storage?.fields ?? {};
  cached = {};
  for (const [f, s] of Object.entries(storageFields)) {
    cached[s?.column ?? f] = f;
  }
  perContract.set(cacheKey, cached);
  return cached;
}

interface ResolvedThrough extends ContractRelationThrough {
  readonly requiredPayloadColumns: readonly string[];
}

interface ResolvedRelation {
  readonly to: string;
  readonly toNamespace: string | undefined;
  readonly cardinality: RelationCardinalityTag | undefined;
  readonly on: {
    readonly localFields: readonly string[];
    readonly targetFields: readonly string[];
  };
  readonly through?: ResolvedThrough;
}

export interface ResolvedIncludeRelation {
  readonly relatedModelName: string;
  readonly relatedNamespaceId: string | undefined;
  readonly relatedTableName: string;
  readonly targetColumn: string;
  readonly localColumn: string;
  readonly cardinality: RelationCardinalityTag | undefined;
}

export function resolveIncludeRelation(
  contract: Contract<SqlStorage>,
  modelName: string,
  relationName: string,
  namespaceId?: string,
): ResolvedIncludeRelation {
  const relations = resolveModelRelations(contract, modelName, namespaceId);
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

  const relatedTableName = resolveModelTableName(contract, relation.to, relation.toNamespace);
  const localColumn = resolveFieldToColumn(contract, modelName, localField, namespaceId);
  const targetColumn = resolveFieldToColumn(
    contract,
    relation.to,
    targetField,
    relation.toNamespace,
  );

  return {
    relatedModelName: relation.to,
    relatedNamespaceId: relation.toNamespace,
    relatedTableName,
    targetColumn,
    localColumn,
    cardinality: relation.cardinality,
  };
}

function resolveThrough(
  contract: Contract<SqlStorage>,
  through: ContractRelationThrough | undefined,
): ResolvedThrough | undefined {
  if (!through) return undefined;
  const { table, namespaceId, parentColumns, childColumns, targetColumns } = through;

  const junctionTable = contract.storage.namespaces[namespaceId]?.entries.table[table];
  if (!junctionTable) return undefined;

  const fkColumnSet = new Set<string>([...parentColumns, ...childColumns]);
  const requiredPayloadColumns: string[] = [];
  for (const [colName, col] of Object.entries(junctionTable.columns)) {
    if (!fkColumnSet.has(colName) && !col.nullable && col.default === undefined) {
      requiredPayloadColumns.push(colName);
    }
  }

  return {
    table,
    namespaceId,
    parentColumns,
    childColumns,
    targetColumns,
    requiredPayloadColumns,
  };
}

const modelRelationsCache = new WeakMap<object, Map<string, Record<string, ResolvedRelation>>>();

export function resolveModelRelations(
  contract: Contract<SqlStorage>,
  modelName: string,
  namespaceId?: string,
): Record<string, ResolvedRelation> {
  let perContract = modelRelationsCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    modelRelationsCache.set(contract, perContract);
  }
  const cacheKey = metadataCacheKey(modelName, namespaceId);
  const cached = perContract.get(cacheKey);
  if (cached) return cached;

  const models = modelsOf(contract, namespaceId);
  const relationMap = models[modelName]?.relations ?? {};
  const resolved: Record<string, ResolvedRelation> = {};

  for (const [name, value] of Object.entries(relationMap)) {
    if (!value || typeof value !== 'object') continue;

    const rel = value as {
      to?: CrossReference;
      cardinality?: unknown;
      on?: { localFields?: unknown; targetFields?: unknown };
      through?: ContractRelationThrough;
    };
    const localFields = rel.on?.localFields;
    const targetFields = rel.on?.targetFields;

    if (
      !rel.to ||
      typeof rel.to !== 'object' ||
      typeof rel.to.model !== 'string' ||
      !Array.isArray(localFields) ||
      !Array.isArray(targetFields)
    ) {
      continue;
    }

    const through = resolveThrough(contract, rel.through);

    resolved[name] = {
      to: rel.to.model,
      toNamespace: typeof rel.to.namespace === 'string' ? rel.to.namespace : undefined,
      cardinality: parseRelationCardinality(rel.cardinality),
      on: {
        localFields: localFields as readonly string[],
        targetFields: targetFields as readonly string[],
      },
      ...(through !== undefined ? { through } : {}),
    };
  }

  perContract.set(cacheKey, resolved);
  return resolved;
}

export function parseRelationCardinality(value: unknown): RelationCardinalityTag | undefined {
  if (value === '1:1' || value === 'N:1' || value === '1:N' || value === 'N:M') {
    return value;
  }
  return undefined;
}

export function resolveUpsertConflictColumns(
  contract: Contract<SqlStorage>,
  modelName: string,
  conflictOn: Record<string, unknown> | undefined,
  namespaceId?: string,
): string[] {
  if (conflictOn && typeof conflictOn === 'object') {
    const columns = Object.keys(conflictOn).map((fieldName) =>
      resolveFieldToColumn(contract, modelName, fieldName, namespaceId),
    );
    if (columns.length > 0) {
      return columns;
    }
  }

  const tableName = resolveModelTableName(contract, modelName, namespaceId);
  const primaryKeyColumns = storageTableForContract(contract, tableName).primaryKey?.columns ?? [];
  return [...primaryKeyColumns];
}

export function resolveModelTableName(
  contract: Contract<SqlStorage>,
  modelName: string,
  namespaceId?: string,
): string {
  if (namespaceId !== undefined) {
    const table = domainModelTableInNamespace(contract, namespaceId, modelName);
    if (table === undefined) {
      throw new Error(
        `Model "${modelName}" has invalid or missing storage.table in namespace "${namespaceId}"`,
      );
    }
    return table;
  }
  const resolved = resolveDomainModelForContract(contract, modelName);
  if (!resolved) {
    throw new Error(`Model "${modelName}" not found in contract`);
  }
  const model = resolved.model as ModelEntry;
  if (model.storage && typeof model.storage.table === 'string') {
    return model.storage.table;
  }
  throw new Error(`Model "${modelName}" has invalid or missing storage.table in the contract`);
}

export function resolvePrimaryKeyColumn(
  contract: Contract<SqlStorage>,
  tableName: string,
  namespaceId?: string,
): string {
  const resolved = resolveTableForContract(contract, tableName, namespaceId);
  return resolved?.table.primaryKey?.columns[0] ?? 'id';
}

export function resolveRowIdentityColumns(
  contract: Contract<SqlStorage>,
  tableName: string,
): readonly string[] {
  let table: StorageTable;
  try {
    table = storageTableForContract(contract, tableName);
  } catch {
    return [];
  }
  if (table.primaryKey && table.primaryKey.columns.length > 0) {
    return table.primaryKey.columns;
  }
  for (const unique of table.uniques) {
    if (unique.columns.length > 0) {
      return unique.columns;
    }
  }
  return [];
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
