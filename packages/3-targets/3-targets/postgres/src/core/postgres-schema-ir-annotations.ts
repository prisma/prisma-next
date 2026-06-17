import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { isPostgresSchema } from './postgres-schema';
import { isPostgresSchemaIR } from './postgres-schema-ir';

export function resolveDdlSchemaForNamespaceStorage(
  storage: SqlStorage,
  namespaceId: string,
  schemaIr?: SqlSchemaIR,
): string {
  if (namespaceId === UNBOUND_NAMESPACE_ID) {
    return (
      (schemaIr && isPostgresSchemaIR(schemaIr) ? schemaIr.pgSchemaName : undefined) ?? 'public'
    );
  }
  const namespace = storage.namespaces[namespaceId];
  if (namespace && isPostgresSchema(namespace)) {
    return namespace.ddlSchemaName(storage);
  }
  return namespaceId;
}
