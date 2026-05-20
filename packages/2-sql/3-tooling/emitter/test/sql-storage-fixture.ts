import type { Contract } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';

export function namespacedSqlStorage(parts: {
  readonly tables: Record<string, unknown>;
  readonly types?: Record<string, unknown>;
}) {
  return {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, tables: parts.tables },
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
    return storage;
  }
  if ('tables' in s) {
    return namespacedSqlStorage({
      tables: s.tables as Record<string, unknown>,
      ...(s.types !== undefined ? { types: s.types as Record<string, unknown> } : {}),
    }) as Contract['storage'];
  }
  return storage;
}
