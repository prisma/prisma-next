import type { Contract } from '@prisma-next/contract/types';
import type { DdlIntent, ResolvedDdlSubject } from '@prisma-next/family-sql/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  isPostgresEnumStorageEntry,
  type SqlStorage,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import { isPostgresSchema } from '../postgres-schema';
import type { PostgresOpFactoryCall } from './op-factory-call';
import { resolveDdlSchemaForNamespace } from './planner-strategies';

function tableAt(
  storage: SqlStorage,
  namespaceId: string,
  tableName: string,
): StorageTable | undefined {
  const raw = storage.namespaces[namespaceId]?.tables?.[tableName];
  return raw instanceof StorageTable ? raw : undefined;
}

function resolveNamespaceIdForTable(
  contract: Contract<SqlStorage>,
  tableName: string,
  ddlSchemaName: string | undefined,
): string {
  for (const namespaceId of Object.keys(contract.storage.namespaces)) {
    const table = tableAt(contract.storage, namespaceId, tableName);
    if (!table) continue;
    const ctx = { toContract: contract } as Parameters<typeof resolveDdlSchemaForNamespace>[0];
    if (
      ddlSchemaName === undefined ||
      resolveDdlSchemaForNamespace(ctx, namespaceId) === ddlSchemaName
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

export function postgresCallDdlIntent(call: PostgresOpFactoryCall): DdlIntent | null {
  switch (call.factoryName) {
    case 'createSchema':
    case 'createTable':
    case 'addColumn':
    case 'createEnumType':
    case 'addEnumValues':
    case 'createIndex':
    case 'addPrimaryKey':
    case 'addUnique':
    case 'addForeignKey':
    case 'createExtension':
      return 'create';
    case 'dropTable':
    case 'dropColumn':
    case 'dropConstraint':
    case 'dropIndex':
    case 'dropDefault':
    case 'dropEnumType':
      return 'drop';
    case 'alterColumnType':
    case 'setNotNull':
    case 'dropNotNull':
    case 'setDefault':
    case 'renameType':
    case 'dataTransform':
      return 'alter';
    case 'rawSql': {
      const op = (
        call as {
          op?: { target?: { details?: { objectType?: string } } };
        }
      ).op;
      if (op?.target?.details?.objectType === 'type') {
        return 'create';
      }
      return 'alter';
    }
    default:
      return 'alter';
  }
}

export function resolvePostgresCallDdlSubject(
  call: PostgresOpFactoryCall,
  contract: Contract<SqlStorage>,
): ResolvedDdlSubject | undefined {
  const intent = postgresCallDdlIntent(call);
  if (intent === null) {
    return undefined;
  }

  const callFields = call as {
    schemaName?: string;
    tableName?: string;
    columnName?: string;
    typeName?: string;
  };

  if (call.factoryName === 'createSchema' && callFields.schemaName) {
    const namespaceId = resolveNamespaceIdForDdlSchema(contract, callFields.schemaName);
    return {
      namespaceId,
      intent,
    };
  }

  if (callFields.typeName && call.factoryName !== 'addColumn') {
    const namespaceId = callFields.schemaName
      ? resolveNamespaceIdForDdlSchema(contract, callFields.schemaName)
      : UNBOUND_NAMESPACE_ID;
    const ns = contract.storage.namespaces[namespaceId];
    const rawEnum =
      ns && 'enum' in ns && ns.enum != null
        ? (ns.enum as Record<string, unknown>)[callFields.typeName]
        : undefined;
    const control = isPostgresEnumStorageEntry(rawEnum) ? rawEnum.control : undefined;
    return {
      namespaceId,
      intent,
      ...(control !== undefined ? { explicitNodeControl: control } : {}),
      typeName: callFields.typeName,
    };
  }

  if (callFields.tableName) {
    const namespaceId = resolveNamespaceIdForTable(
      contract,
      callFields.tableName,
      callFields.schemaName,
    );
    const table = tableAt(contract.storage, namespaceId, callFields.tableName);
    const tableControl = table?.control;
    return {
      namespaceId,
      intent,
      ...(tableControl !== undefined ? { explicitNodeControl: tableControl } : {}),
      table: callFields.tableName,
      ...(callFields.columnName !== undefined ? { column: callFields.columnName } : {}),
    };
  }

  if (callFields.schemaName) {
    return {
      namespaceId: resolveNamespaceIdForDdlSchema(contract, callFields.schemaName),
      intent,
    };
  }

  return undefined;
}
