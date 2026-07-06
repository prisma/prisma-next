import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { isPostgresSchema } from '../postgres-schema';

/**
 * Given the contract's storage and a namespace id, returns the live Postgres
 * DDL schema name that namespace maps to. A named Postgres namespace dispatches
 * to its `ddlSchemaName(storage)`; the unbound sentinel resolves to `public`
 * (the search-path default for offline planning); a bare object payload (used
 * by some tests) falls back to the namespace id itself.
 */
export function resolveDdlSchemaForNamespaceStorage(
  storage: SqlStorage,
  namespaceId: string,
): string {
  if (namespaceId === UNBOUND_NAMESPACE_ID) {
    return 'public';
  }
  const namespace = storage.namespaces[namespaceId];
  if (namespace && isPostgresSchema(namespace)) {
    return namespace.ddlSchemaName(storage);
  }
  return namespaceId;
}
