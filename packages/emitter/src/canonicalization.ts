import type { ContractIR } from './types';

type NormalizedContract = {
  schemaVersion: string;
  targetFamily: string;
  target: string;
  coreHash?: string;
  profileHash?: string;
  models: Record<string, unknown>;
  relations: Record<string, unknown>;
  storage: Record<string, unknown>;
  extensions: Record<string, unknown>;
  capabilities: Record<string, Record<string, boolean>>;
  meta: Record<string, unknown>;
  sources: Record<string, unknown>;
};

const TOP_LEVEL_ORDER = [
  'schemaVersion',
  'canonicalVersion',
  'targetFamily',
  'target',
  'coreHash',
  'profileHash',
  'models',
  'storage',
  'capabilities',
  'extensions',
  'meta',
  'sources',
] as const;

function isDefaultValue(value: unknown): boolean {
  if (value === false) return true;
  if (value === null) return false;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    return keys.length === 0;
  }
  return false;
}

function omitDefaults(obj: unknown, path: readonly string[]): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => omitDefaults(item, path));
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = [...path, key];

    // Exclude metadata fields from canonicalization
    if (key === '_generated') {
      continue;
    }

    if (key === 'nullable' && value === false) {
      continue;
    }

    if (key === 'generated' && value === false) {
      continue;
    }

    if (isDefaultValue(value)) {
      const isRequiredModels = currentPath.length === 1 && currentPath[0] === 'models';
      const isRequiredTables =
        currentPath.length === 2 && currentPath[0] === 'storage' && currentPath[1] === 'tables';
      const isRequiredRelations = currentPath.length === 1 && currentPath[0] === 'relations';
      const isRequiredExtensions = currentPath.length === 1 && currentPath[0] === 'extensions';
      const isRequiredCapabilities = currentPath.length === 1 && currentPath[0] === 'capabilities';
      const isRequiredMeta = currentPath.length === 1 && currentPath[0] === 'meta';
      const isRequiredSources = currentPath.length === 1 && currentPath[0] === 'sources';
      const isExtensionNamespace =
        currentPath.length === 2 && currentPath[0] === 'extensions';
      const isModelRelations =
        currentPath.length === 3 && currentPath[0] === 'models' && currentPath[2] === 'relations';
      const isTableUniques =
        currentPath.length === 4 &&
        currentPath[0] === 'storage' &&
        currentPath[1] === 'tables' &&
        currentPath[3] === 'uniques';
      const isTableIndexes =
        currentPath.length === 4 &&
        currentPath[0] === 'storage' &&
        currentPath[1] === 'tables' &&
        currentPath[3] === 'indexes';
      const isTableForeignKeys =
        currentPath.length === 4 &&
        currentPath[0] === 'storage' &&
        currentPath[1] === 'tables' &&
        currentPath[3] === 'foreignKeys';

      if (
        !isRequiredModels &&
        !isRequiredTables &&
        !isRequiredRelations &&
        !isRequiredExtensions &&
        !isRequiredCapabilities &&
        !isRequiredMeta &&
        !isRequiredSources &&
        !isExtensionNamespace &&
        !isModelRelations &&
        !isTableUniques &&
        !isTableIndexes &&
        !isTableForeignKeys
      ) {
        continue;
      }
    }

    result[key] = omitDefaults(value, currentPath);
  }

  return result;
}

function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sortObjectKeys(item));
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj).sort();
  for (const key of keys) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }

  return sorted;
}

type StorageObject = {
  tables?: Record<string, unknown>;
  [key: string]: unknown;
};

type TableObject = {
  indexes?: unknown[];
  uniques?: unknown[];
  [key: string]: unknown;
};

function sortIndexesAndUniques(storage: unknown): unknown {
  if (!storage || typeof storage !== 'object') {
    return storage;
  }

  const storageObj = storage as StorageObject;
  if (!storageObj.tables || typeof storageObj.tables !== 'object') {
    return storage;
  }

  const tables = storageObj.tables;
  const result: StorageObject = { ...storageObj };

  result.tables = {};
  for (const [tableName, table] of Object.entries(tables)) {
    if (!table || typeof table !== 'object') {
      result.tables[tableName] = table;
      continue;
    }

    const tableObj = table as TableObject;
    const sortedTable: TableObject = { ...tableObj };

    if (Array.isArray(tableObj.indexes)) {
      sortedTable.indexes = [...tableObj.indexes].sort((a, b) => {
        const nameA = (a as { name?: string })?.name || '';
        const nameB = (b as { name?: string })?.name || '';
        return nameA.localeCompare(nameB);
      });
    }

    if (Array.isArray(tableObj.uniques)) {
      sortedTable.uniques = [...tableObj.uniques].sort((a, b) => {
        const nameA = (a as { name?: string })?.name || '';
        const nameB = (b as { name?: string })?.name || '';
        return nameA.localeCompare(nameB);
      });
    }

    result.tables[tableName] = sortedTable;
  }

  return result;
}

function orderTopLevel(obj: Record<string, unknown>): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  const remaining = new Set(Object.keys(obj));

  for (const key of TOP_LEVEL_ORDER) {
    if (remaining.has(key)) {
      ordered[key] = obj[key];
      remaining.delete(key);
    }
  }

  for (const key of Array.from(remaining).sort()) {
    ordered[key] = obj[key];
  }

  return ordered;
}

export function canonicalizeContract(
  ir: ContractIR & { coreHash?: string; profileHash?: string },
): string {
  const normalized: NormalizedContract = {
    schemaVersion: ir.schemaVersion,
    targetFamily: ir.targetFamily,
    target: ir.target,
    models: ir.models,
    relations: ir.relations,
    storage: ir.storage,
    extensions: ir.extensions,
    capabilities: ir.capabilities,
    meta: ir.meta,
    sources: ir.sources,
  };

  if (ir.coreHash !== undefined) {
    normalized.coreHash = ir.coreHash;
  }

  if (ir.profileHash !== undefined) {
    normalized.profileHash = ir.profileHash;
  }

  const withDefaultsOmitted = omitDefaults(normalized, []) as NormalizedContract;
  const withSortedIndexes = sortIndexesAndUniques(withDefaultsOmitted.storage);
  const withSortedStorage = { ...withDefaultsOmitted, storage: withSortedIndexes };
  const withSortedKeys = sortObjectKeys(withSortedStorage) as Record<string, unknown>;
  const withOrderedTopLevel = orderTopLevel(withSortedKeys);

  return JSON.stringify(withOrderedTopLevel, null, 2);
}
