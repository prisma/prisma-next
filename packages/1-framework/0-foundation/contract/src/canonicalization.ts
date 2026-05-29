import { isArrayEqual } from '@prisma-next/utils/array-equal';
import { ifDefined } from '@prisma-next/utils/defined';
import type { JsonObject } from '@prisma-next/utils/json';

import type { Contract } from './contract-types';

/**
 * Per-target contract serializer hook. The framework canonicalizer uses
 * this to convert an in-memory contract (which may carry class-instance
 * IR nodes whose runtime-only fields must not appear in the on-disk
 * envelope) into a plain JsonObject before applying the family-agnostic
 * canonical-key ordering / default-omission / sort steps. Targets whose
 * contract is JSON-clean by construction return the contract unchanged.
 */
export type SerializeContract = (contract: Contract) => JsonObject;

const TOP_LEVEL_ORDER = [
  'schemaVersion',
  'canonicalVersion',
  'targetFamily',
  'target',
  'profileHash',
  'roots',
  'models',
  'valueObjects',
  'domain',
  'storage',
  'execution',
  'capabilities',
  'extensionPacks',
  'meta',
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

    if (key === '_generated') {
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
      const isRequiredNamespaces = isArrayEqual(currentPath, ['storage', 'namespaces']);
      const isNamespaceSlot =
        currentPath.length === 3 &&
        isArrayEqual([currentPath[0], currentPath[1]], ['storage', 'namespaces']);
      const isRequiredNamespaceTables =
        currentPath.length === 4 &&
        currentPath[0] === 'storage' &&
        currentPath[1] === 'namespaces' &&
        currentPath[3] === 'tables';
      // Preserve per-table payloads even when empty. SQL tables are never
      // emitted empty; Mongo collections legitimately are (a declared
      // collection with no schema is a valid representation), and the
      // family-agnostic canonicalizer must not strip them.
      const isNamespaceTableEntry =
        currentPath.length === 5 &&
        currentPath[0] === 'storage' &&
        currentPath[1] === 'namespaces' &&
        currentPath[3] === 'tables';
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
      const isModelStorage =
        currentPath.length === 3 &&
        isArrayEqual([currentPath[0], currentPath[2]], ['models', 'storage']);
      const isNamespaceTableUniques =
        currentPath.length === 6 &&
        currentPath[0] === 'storage' &&
        currentPath[1] === 'namespaces' &&
        currentPath[3] === 'tables' &&
        currentPath[5] === 'uniques';
      const isNamespaceTableIndexes =
        currentPath.length === 6 &&
        currentPath[0] === 'storage' &&
        currentPath[1] === 'namespaces' &&
        currentPath[3] === 'tables' &&
        currentPath[5] === 'indexes';
      const isNamespaceTableForeignKeys =
        currentPath.length === 6 &&
        currentPath[0] === 'storage' &&
        currentPath[1] === 'namespaces' &&
        currentPath[3] === 'tables' &&
        currentPath[5] === 'foreignKeys';

      // `storage.types.<name>.typeParams` is part of the StorageTypeInstance
      // shape (validators require it). Preserve it even when empty so the
      // emitted contract.json remains structurally valid after a round-trip.
      const isStorageTypeTypeParams =
        currentPath.length === 4 &&
        currentPath[0] === 'storage' &&
        currentPath[1] === 'types' &&
        key === 'typeParams';

      const isDomainUnboundTypeParams =
        currentPath.length === 5 &&
        currentPath[0] === 'domain' &&
        currentPath[2] === 'types' &&
        key === 'typeParams';

      const isFkBooleanField =
        currentPath.length === 7 &&
        currentPath[0] === 'storage' &&
        currentPath[1] === 'namespaces' &&
        currentPath[3] === 'tables' &&
        currentPath[5] === 'foreignKeys' &&
        (key === 'constraint' || key === 'index');

      const isNullableField = key === 'nullable';

      if (
        !isRequiredModels &&
        !isRequiredNamespaces &&
        !isNamespaceSlot &&
        !isRequiredNamespaceTables &&
        !isNamespaceTableEntry &&
        !isRequiredRoots &&
        !isRequiredExtensionPacks &&
        !isRequiredCapabilities &&
        !isRequiredMeta &&
        !isRequiredExecutionDefaults &&
        !isExtensionNamespace &&
        !isModelRelations &&
        !isModelStorage &&
        !isNamespaceTableUniques &&
        !isNamespaceTableIndexes &&
        !isNamespaceTableForeignKeys &&
        !isFkBooleanField &&
        !isNullableField &&
        !isStorageTypeTypeParams &&
        !isDomainUnboundTypeParams
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

type NamespaceObject = {
  tables?: Record<string, unknown>;
  [key: string]: unknown;
};

type StorageObject = {
  namespaces?: Record<string, unknown>;
  [key: string]: unknown;
};

type TableObject = {
  indexes?: unknown[];
  uniques?: unknown[];
  [key: string]: unknown;
};

function sortTableArrays(tableObj: TableObject): TableObject {
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

  return sortedTable;
}

function sortIndexesAndUniques(storage: unknown): unknown {
  if (!storage || typeof storage !== 'object') {
    return storage;
  }

  const storageObj = storage as StorageObject;
  if (!storageObj.namespaces || typeof storageObj.namespaces !== 'object') {
    return storage;
  }

  const namespaces = storageObj.namespaces;
  const result: StorageObject = { ...storageObj, namespaces: {} };
  const resultNamespaces = result.namespaces as Record<string, unknown>;

  for (const nsId of Object.keys(namespaces)) {
    const ns = namespaces[nsId];
    if (!ns || typeof ns !== 'object') {
      resultNamespaces[nsId] = ns;
      continue;
    }

    const nsObj = ns as NamespaceObject;
    if (!nsObj.tables || typeof nsObj.tables !== 'object') {
      resultNamespaces[nsId] = ns;
      continue;
    }

    const sortedTables: Record<string, unknown> = {};
    const sortedTableNames = Object.keys(nsObj.tables).sort();
    for (const tableName of sortedTableNames) {
      const table = nsObj.tables[tableName];
      if (!table || typeof table !== 'object') {
        sortedTables[tableName] = table;
        continue;
      }
      sortedTables[tableName] = sortTableArrays(table as TableObject);
    }

    resultNamespaces[nsId] = { ...nsObj, tables: sortedTables };
  }

  return result;
}

export function orderTopLevel(obj: Record<string, unknown>): Record<string, unknown> {
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

export interface CanonicalizeContractOptions {
  readonly schemaVersion?: string;
  /**
   * Per-target hook that converts the in-memory contract (which may
   * carry class-instance IR nodes) into a plain JsonObject before the
   * family-agnostic canonicalization steps run.
   *
   * Routing through the hook is what lets each target decide which
   * fields appear in the on-disk envelope; runtime-only class API
   * fields stay invisible to the canonicalization walk by virtue of
   * the per-target serializer not putting them in the JSON shape.
   */
  readonly serializeContract: SerializeContract;
}

/**
 * Object-form variant of {@link canonicalizeContract}. Exported because the
 * emitter writes the canonical contract through a separate JSON-stringify
 * pass and consumes the structured object directly.
 */
export function canonicalizeContractToObject(
  contract: Contract,
  options: CanonicalizeContractOptions,
): Record<string, unknown> {
  const serialized = options.serializeContract(contract);
  const normalized: Record<string, unknown> = {
    ...ifDefined('schemaVersion', options.schemaVersion),
    targetFamily: serialized['targetFamily'],
    target: serialized['target'],
    profileHash: serialized['profileHash'],
    roots: serialized['roots'],
    models: serialized['models'],
    ...ifDefined('valueObjects', serialized['valueObjects']),
    ...ifDefined('domain', serialized['domain']),
    storage: serialized['storage'],
    ...ifDefined('execution', serialized['execution']),
    extensionPacks: serialized['extensionPacks'],
    capabilities: serialized['capabilities'],
    meta: serialized['meta'],
  };
  const withDefaultsOmitted = omitDefaults(normalized, []) as Record<string, unknown>;
  const withSortedIndexes = sortIndexesAndUniques(withDefaultsOmitted['storage']);
  const withSortedStorage = { ...withDefaultsOmitted, storage: withSortedIndexes };
  const withSortedKeys = sortObjectKeys(withSortedStorage) as Record<string, unknown>;
  return orderTopLevel(withSortedKeys);
}

export function canonicalizeContract(
  contract: Contract,
  options: CanonicalizeContractOptions,
): string {
  return JSON.stringify(canonicalizeContractToObject(contract, options), null, 2);
}
