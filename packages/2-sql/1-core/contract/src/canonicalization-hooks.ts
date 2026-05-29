import type { PreserveEmptyPredicate, StorageSort } from '@prisma-next/contract/hashing';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const shouldPreserveEmpty: PreserveEmptyPredicate = (path) => {
  const len = path.length;
  if (len < 2 || path[0] !== 'storage') return false;
  if (path[1] === 'namespaces') {
    if (len === 4 && path[3] === 'tables') return true;
    if (len === 5 && path[3] === 'tables') return true;
    if (
      len === 6 &&
      path[3] === 'tables' &&
      (path[5] === 'uniques' || path[5] === 'indexes' || path[5] === 'foreignKeys')
    )
      return true;
    if (
      len === 7 &&
      path[3] === 'tables' &&
      path[5] === 'foreignKeys' &&
      (path[6] === 'constraint' || path[6] === 'index')
    )
      return true;
  }
  if (path[1] === 'types' && len === 4 && path[3] === 'typeParams') return true;
  return false;
};

const sortStorage: StorageSort = (storage) => {
  if (!isPlainRecord(storage)) return storage;
  const namespaces = storage['namespaces'];
  if (!isPlainRecord(namespaces)) return storage;
  const sortedNamespaces: Record<string, unknown> = {};
  for (const nsId of Object.keys(namespaces)) {
    const ns = namespaces[nsId];
    if (!isPlainRecord(ns)) {
      sortedNamespaces[nsId] = ns;
      continue;
    }
    const tables = ns['tables'];
    if (!isPlainRecord(tables)) {
      sortedNamespaces[nsId] = ns;
      continue;
    }
    const sortedTables: Record<string, unknown> = {};
    for (const tableName of Object.keys(tables)) {
      const table = tables[tableName];
      if (!isPlainRecord(table)) {
        sortedTables[tableName] = table;
        continue;
      }
      sortedTables[tableName] = sortTableArrays(table);
    }
    sortedNamespaces[nsId] = { ...ns, tables: sortedTables };
  }
  return { ...storage, namespaces: sortedNamespaces };
};

function sortTableArrays(table: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = { ...table };
  const byName = (a: unknown, b: unknown): number => {
    const na = isPlainRecord(a) && typeof a['name'] === 'string' ? a['name'] : '';
    const nb = isPlainRecord(b) && typeof b['name'] === 'string' ? b['name'] : '';
    return na.localeCompare(nb);
  };
  if (Array.isArray(table['indexes'])) {
    sorted['indexes'] = [...table['indexes']].sort(byName);
  }
  if (Array.isArray(table['uniques'])) {
    sorted['uniques'] = [...table['uniques']].sort(byName);
  }
  return sorted;
}

export const sqlContractCanonicalizationHooks = {
  shouldPreserveEmpty,
  sortStorage,
} as const;
