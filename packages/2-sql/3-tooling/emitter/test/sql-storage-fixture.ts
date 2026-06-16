import type { Contract } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';

function makeRawNamespace(id: string, entries: Record<string, unknown>) {
  return { id, kind: 'test-sql-namespace', entries };
}

export function namespacedSqlStorage(parts: {
  readonly tables: Record<string, unknown>;
  readonly types?: Record<string, unknown>;
}) {
  return {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: makeRawNamespace(UNBOUND_NAMESPACE_ID, { table: parts.tables }),
    },
    ...(parts.types !== undefined ? { types: parts.types } : {}),
  };
}

export function normalizeRootSqlStorage(
  storage: Contract['storage'] | undefined,
): Contract['storage'] | undefined {
  if (storage === undefined || storage === null) {
    return storage;
  }
  const s = storage as Record<string, unknown>;
  if ('namespaces' in s) {
    const namespaces = s.namespaces;
    if (namespaces !== null && typeof namespaces === 'object' && !Array.isArray(namespaces)) {
      let changed = false;
      const lifted = Object.fromEntries(
        Object.entries(namespaces as Record<string, Record<string, unknown>>).map(([id, ns]) => {
          if (ns === null || typeof ns !== 'object' || Array.isArray(ns) || 'entries' in ns) {
            return [id, ns];
          }
          if ('tables' in ns) {
            changed = true;
            const nsId = typeof ns.id === 'string' ? ns.id : id;
            return [id, makeRawNamespace(nsId, { table: ns.tables as Record<string, unknown> })];
          }
          return [id, ns];
        }),
      );
      if (changed) {
        return { ...s, namespaces: lifted } as Contract['storage'];
      }
    }
    return storage;
  }
  if ('tables' in s) {
    return namespacedSqlStorage({
      tables: s.tables as Record<string, unknown>,
      ...(s.types !== undefined ? { types: s.types as Record<string, unknown> } : {}),
    }) as Contract['storage'];
  }
  const entries = s.entries;
  if (entries !== null && typeof entries === 'object' && !Array.isArray(entries)) {
    const table = (entries as { table?: Record<string, unknown> }).table;
    if (table !== undefined) {
      return namespacedSqlStorage({
        tables: table,
        ...(s.types !== undefined ? { types: s.types as Record<string, unknown> } : {}),
      }) as Contract['storage'];
    }
  }
  return storage;
}
