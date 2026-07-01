import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { isPostgresSchema } from '../postgres-schema';

/**
 * Resolves a namespace coordinate to its live DDL schema name. Named
 * Postgres namespaces dispatch to `ddlSchemaName(storage)`; the unbound
 * sentinel resolves to `public` (the search-path default for offline
 * planning); bare object payloads fall back to the coordinate itself.
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
