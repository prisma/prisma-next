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
      const isModelStorage =
        currentPath.length === 3 &&
        isArrayEqual([currentPath[0], currentPath[2]], ['models', 'storage']);
      // FR15 nested envelope: `storage.tables.<namespaceId>.<tableName>.<field>`
      // sits at depth 5; the table-level required-empty defaults
      // (`uniques`, `indexes`, `foreignKeys`) must survive at that
      // depth so the persisted shape stays schema-valid.
      const isTableUniques =
        currentPath.length === 5 &&
        isArrayEqual(
          [currentPath[0], currentPath[1], currentPath[4]],
          ['storage', 'tables', 'uniques'],
        );
      const isTableIndexes =
        currentPath.length === 5 &&
        isArrayEqual(
          [currentPath[0], currentPath[1], currentPath[4]],
          ['storage', 'tables', 'indexes'],
        );
      const isTableForeignKeys =
        currentPath.length === 5 &&
        isArrayEqual(
          [currentPath[0], currentPath[1], currentPath[4]],
          ['storage', 'tables', 'foreignKeys'],
        );
      // The namespace bucket itself (`storage.tables.<namespaceId>`)
      // must survive even when its table map is empty — a namespace
      // declared but unused is still legitimate.
      const isNamespaceBucket =
        currentPath.length === 3 && currentPath[0] === 'storage' && currentPath[1] === 'tables';

      // `storage.types.<namespaceId>.<typeName>.typeParams` is part
      // of the StorageTypeInstance shape (validators require it).
      // Preserve it even when empty so the emitted contract.json
      // remains structurally valid after a round-trip.
      const isStorageTypeTypeParams =
        currentPath.length === 5 &&
        currentPath[0] === 'storage' &&
        currentPath[1] === 'types' &&
        key === 'typeParams';

      const isFkBooleanField =
        currentPath.length === 6 &&
        currentPath[0] === 'storage' &&
        currentPath[1] === 'tables' &&
        currentPath[4] === 'foreignKeys' &&
        (key === 'constraint' || key === 'index');

      const isNullableField = key === 'nullable';

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
        !isModelStorage &&
        !isTableUniques &&
        !isTableIndexes &&
        !isTableForeignKeys &&
        !isNamespaceBucket &&
        !isFkBooleanField &&
        !isNullableField &&
        !isStorageTypeTypeParams
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

function sortNamedArray(items: unknown[]): unknown[] {
  return [...items].sort((a, b) => {
    const nameA = (a as { name?: string })?.name || '';
    const nameB = (b as { name?: string })?.name || '';
    return nameA.localeCompare(nameB);
  });
}

function sortTableIndexesAndUniques(table: unknown): unknown {
  if (!table || typeof table !== 'object') return table;
  const tableObj = table as TableObject;
  const sortedTable: TableObject = { ...tableObj };
  if (Array.isArray(tableObj.indexes)) {
    sortedTable.indexes = sortNamedArray(tableObj.indexes);
  }
  if (Array.isArray(tableObj.uniques)) {
    sortedTable.uniques = sortNamedArray(tableObj.uniques);
  }
  return sortedTable;
}

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

  // After the reversal the persisted envelope is unconditionally the
  // FR15 nested-by-namespace shape (`storage.tables` keyed by
  // namespace id; each namespace bucket keyed by table name). The
  // canonicaliser walks the nested map and sorts `indexes` /
  // `uniques` arrays at the table-level depth in each bucket.
  const sortedNamespaces: Record<string, Record<string, unknown>> = {};
  for (const namespaceId of Object.keys(tables).sort()) {
    const bucket = tables[namespaceId];
    if (!bucket || typeof bucket !== 'object') continue;
    const bucketRecord = bucket as Record<string, unknown>;
    const sortedBucket: Record<string, unknown> = {};
    for (const tableName of Object.keys(bucketRecord).sort()) {
      sortedBucket[tableName] = sortTableIndexesAndUniques(bucketRecord[tableName]);
    }
    sortedNamespaces[namespaceId] = sortedBucket;
  }
  result.tables = sortedNamespaces;
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
