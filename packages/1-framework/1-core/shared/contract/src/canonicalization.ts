import { isArrayEqual } from '@prisma-next/utils/array-equal';

import type { StorageBase } from './types';
import { bigintJsonReplacer } from './types';

const TOP_LEVEL_ORDER = [
  'schemaVersion',
  'canonicalVersion',
  'targetFamily',
  'target',
  'storageHash',
  'executionHash',
  'profileHash',
  'roots',
  'models',
  'storage',
  'execution',
  'capabilities',
  'extensionPacks',
  'meta',
] as const;

function isDefaultValue(value: unknown): boolean {
  if (value === false) return true;
  if (value === null) return false;
  if (value instanceof Date) return false;
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

  if (obj instanceof Date) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => omitDefaults(item, path));
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = [...path, key];

    if (key === '_generated') {
      continue;
    }

    if (key === 'nullable' && value === false) {
      continue;
    }

    if (key === 'generated' && value === false) {
      continue;
    }

    if ((key === 'onDelete' || key === 'onUpdate') && value === 'noAction') {
      continue;
    }

    if (isDefaultValue(value)) {
      const isRequiredModels = isArrayEqual(currentPath, ['models']);
      const isRequiredTables = isArrayEqual(currentPath, ['storage', 'tables']);
      const isRequiredCollections = isArrayEqual(currentPath, ['storage', 'collections']);
      const isCollectionEntry =
        currentPath.length === 3 &&
        isArrayEqual([currentPath[0], currentPath[1]], ['storage', 'collections']);
      const isRequiredRoots = isArrayEqual(currentPath, ['roots']);
      const isRequiredExtensionPacks = isArrayEqual(currentPath, ['extensionPacks']);
      const isRequiredCapabilities = isArrayEqual(currentPath, ['capabilities']);
      const isRequiredMeta = isArrayEqual(currentPath, ['meta']);
      const isRequiredExecutionDefaults = isArrayEqual(currentPath, [
        'execution',
        'mutations',
        'defaults',
      ]);
      const isExtensionNamespace = currentPath.length === 2 && currentPath[0] === 'extensionPacks';
      const isModelRelations =
        currentPath.length === 3 &&
        isArrayEqual([currentPath[0], currentPath[2]], ['models', 'relations']);
      const isTableUniques =
        currentPath.length === 4 &&
        isArrayEqual(
          [currentPath[0], currentPath[1], currentPath[3]],
          ['storage', 'tables', 'uniques'],
        );
      const isTableIndexes =
        currentPath.length === 4 &&
        isArrayEqual(
          [currentPath[0], currentPath[1], currentPath[3]],
          ['storage', 'tables', 'indexes'],
        );
      const isTableForeignKeys =
        currentPath.length === 4 &&
        isArrayEqual(
          [currentPath[0], currentPath[1], currentPath[3]],
          ['storage', 'tables', 'foreignKeys'],
        );

      const isFkBooleanField =
        currentPath.length === 5 &&
        currentPath[0] === 'storage' &&
        currentPath[1] === 'tables' &&
        currentPath[3] === 'foreignKeys' &&
        (key === 'constraint' || key === 'index');

      if (
        !isRequiredModels &&
        !isRequiredTables &&
        !isRequiredCollections &&
        !isCollectionEntry &&
        !isRequiredRoots &&
        !isRequiredExtensionPacks &&
        !isRequiredCapabilities &&
        !isRequiredMeta &&
        !isRequiredExecutionDefaults &&
        !isExtensionNamespace &&
        !isModelRelations &&
        !isTableUniques &&
        !isTableIndexes &&
        !isTableForeignKeys &&
        !isFkBooleanField
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

  if (obj instanceof Date) {
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
  const sortedTableNames = Object.keys(tables).sort();
  for (const tableName of sortedTableNames) {
    const table = tables[tableName];
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

export type CanonicalContractInput = {
  readonly schemaVersion?: string | undefined;
  readonly targetFamily: string;
  readonly target: string;
  readonly roots?: Record<string, string> | undefined;
  readonly models: Record<string, unknown>;
  readonly storage: StorageBase | Record<string, unknown>;
  readonly execution?: Record<string, unknown> | undefined;
  readonly extensionPacks: Record<string, unknown>;
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly meta: Record<string, unknown>;
  readonly storageHash?: string | undefined;
  readonly executionHash?: string | undefined;
  readonly profileHash?: string | undefined;
};

export function canonicalizeContract(input: CanonicalContractInput): string {
  const i = input as Record<string, unknown>;
  const normalized: Record<string, unknown> = {
    ...(i['schemaVersion'] !== undefined ? { schemaVersion: i['schemaVersion'] } : {}),
    targetFamily: i['targetFamily'],
    target: i['target'],
    ...(i['roots'] !== undefined ? { roots: i['roots'] } : {}),
    models: i['models'],
    storage: i['storage'],
    ...(i['execution'] !== undefined ? { execution: i['execution'] } : {}),
    extensionPacks: i['extensionPacks'],
    capabilities: i['capabilities'],
    meta: i['meta'],
  };
  if (i['storageHash'] !== undefined) {
    normalized['storageHash'] = i['storageHash'];
  }
  if (i['executionHash'] !== undefined) {
    normalized['executionHash'] = i['executionHash'];
  }
  if (i['profileHash'] !== undefined) {
    normalized['profileHash'] = i['profileHash'];
  }

  const withDefaultsOmitted = omitDefaults(normalized, []) as Record<string, unknown>;
  const withSortedIndexes = sortIndexesAndUniques(withDefaultsOmitted['storage']);
  const withSortedStorage = { ...withDefaultsOmitted, storage: withSortedIndexes };
  const withSortedKeys = sortObjectKeys(withSortedStorage) as Record<string, unknown>;
  const withOrderedTopLevel = orderTopLevel(withSortedKeys);

  return JSON.stringify(withOrderedTopLevel, bigintJsonReplacer, 2);
}
