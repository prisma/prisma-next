import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import type { PostgresRlsPolicy } from './postgres-rls-policy';
import type { PostgresRole } from './postgres-role';
import { isPostgresSchema } from './postgres-schema';

/** Postgres-specific subtree on family `SqlSchemaIR.annotations`. */
export interface PostgresSchemaIrAnnotations {
  readonly schema?: string;
  readonly rlsPolicies?: readonly PostgresRlsPolicy[];
  readonly roles?: readonly PostgresRole[];
  readonly nativeEnumTypeNames?: readonly string[];
}

export function readPostgresSchemaIrAnnotations(schema: SqlSchemaIR): PostgresSchemaIrAnnotations {
  const raw = schema.annotations?.['pg'];
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const schemaField = Reflect.get(raw, 'schema');
  const rlsPoliciesRaw = Reflect.get(raw, 'rlsPolicies');
  const rolesRaw = Reflect.get(raw, 'roles');
  const nativeEnumTypeNamesRaw = Reflect.get(raw, 'nativeEnumTypeNames');

  return {
    ...(typeof schemaField === 'string' ? { schema: schemaField } : {}),
    ...(Array.isArray(rlsPoliciesRaw)
      ? { rlsPolicies: rlsPoliciesRaw as readonly PostgresRlsPolicy[] }
      : {}),
    ...(Array.isArray(rolesRaw) ? { roles: rolesRaw as readonly PostgresRole[] } : {}),
    ...(Array.isArray(nativeEnumTypeNamesRaw)
      ? { nativeEnumTypeNames: nativeEnumTypeNamesRaw as readonly string[] }
      : {}),
  };
}

export function resolveDdlSchemaForNamespaceStorage(
  storage: SqlStorage,
  namespaceId: string,
  schemaIr?: SqlSchemaIR,
): string {
  if (namespaceId === UNBOUND_NAMESPACE_ID) {
    return (schemaIr ? readPostgresSchemaIrAnnotations(schemaIr).schema : undefined) ?? 'public';
  }
  const namespace = storage.namespaces[namespaceId];
  if (namespace && isPostgresSchema(namespace)) {
    return namespace.ddlSchemaName(storage);
  }
  return namespaceId;
}
