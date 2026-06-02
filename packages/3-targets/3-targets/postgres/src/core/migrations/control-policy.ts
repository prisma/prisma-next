import type { Contract } from '@prisma-next/contract/types';
import type { ResolvedControlSubject } from '@prisma-next/family-sql/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  isPostgresEnumStorageEntry,
  type SqlStorage,
  storageTableAt,
} from '@prisma-next/sql-contract/types';
import { isPostgresSchema } from '../postgres-schema';
import type { PostgresOpFactoryCall } from './op-factory-call';

function ddlSchemaNameForNamespace(contract: Contract<SqlStorage>, namespaceId: string): string {
  const namespace = contract.storage.namespaces[namespaceId];
  return isPostgresSchema(namespace) ? namespace.ddlSchemaName(contract.storage) : namespaceId;
}

function resolveNamespaceIdForTable(
  contract: Contract<SqlStorage>,
  tableName: string,
  ddlSchemaName: string | undefined,
): string {
  for (const namespaceId of Object.keys(contract.storage.namespaces)) {
    const table = storageTableAt(contract.storage, namespaceId, tableName);
    if (!table) continue;
    if (
      ddlSchemaName === undefined ||
      ddlSchemaNameForNamespace(contract, namespaceId) === ddlSchemaName
    ) {
      return namespaceId;
    }
  }
  return UNBOUND_NAMESPACE_ID;
}

function resolveNamespaceIdForDdlSchema(
  contract: Contract<SqlStorage>,
  ddlSchemaName: string,
): string {
  for (const namespaceId of Object.keys(contract.storage.namespaces)) {
    const ns = contract.storage.namespaces[namespaceId];
    if (isPostgresSchema(ns) && ns.ddlSchemaName(contract.storage) === ddlSchemaName) {
      return namespaceId;
    }
    if (namespaceId === ddlSchemaName) {
      return namespaceId;
    }
  }
  return UNBOUND_NAMESPACE_ID;
}

interface PostgresCallFields {
  readonly schemaName?: string;
  readonly tableName?: string;
  readonly columnName?: string;
  readonly typeName?: string;
}

function postgresCallFields(call: PostgresOpFactoryCall): PostgresCallFields {
  return {
    ...('schemaName' in call ? { schemaName: call.schemaName } : {}),
    ...('tableName' in call ? { tableName: call.tableName } : {}),
    ...('columnName' in call ? { columnName: call.columnName } : {}),
    ...('typeName' in call ? { typeName: call.typeName } : {}),
  };
}

export function resolvePostgresCallControlSubject(
  call: PostgresOpFactoryCall,
  contract: Contract<SqlStorage>,
): ResolvedControlSubject | undefined {
  const callFields = postgresCallFields(call);

  if (call.factoryName === 'createSchema' && callFields.schemaName) {
    return {
      namespaceId: resolveNamespaceIdForDdlSchema(contract, callFields.schemaName),
    };
  }

  if (callFields.typeName && call.factoryName !== 'addColumn') {
    const namespaceId = callFields.schemaName
      ? resolveNamespaceIdForDdlSchema(contract, callFields.schemaName)
      : UNBOUND_NAMESPACE_ID;
    const ns = contract.storage.namespaces[namespaceId];
    const rawEnum =
      ns && 'enum' in ns && ns.enum != null ? ns.enum[callFields.typeName] : undefined;
    const controlPolicy = isPostgresEnumStorageEntry(rawEnum) ? rawEnum.control : undefined;
    return {
      namespaceId,
      ...(controlPolicy !== undefined ? { explicitNodeControlPolicy: controlPolicy } : {}),
      typeName: callFields.typeName,
    };
  }

  if (callFields.tableName) {
    const namespaceId = resolveNamespaceIdForTable(
      contract,
      callFields.tableName,
      callFields.schemaName,
    );
    const table = storageTableAt(contract.storage, namespaceId, callFields.tableName);
    const tableControlPolicy = table?.control;
    return {
      namespaceId,
      ...(tableControlPolicy !== undefined
        ? { explicitNodeControlPolicy: tableControlPolicy }
        : {}),
      table: callFields.tableName,
      ...(callFields.columnName !== undefined ? { column: callFields.columnName } : {}),
    };
  }

  if (callFields.schemaName) {
    return {
      namespaceId: resolveNamespaceIdForDdlSchema(contract, callFields.schemaName),
    };
  }

  return undefined;
}
