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

function tableAt(
  storage: SqlStorage,
  namespaceId: string,
  tableName: string,
): StorageTable | undefined {
  const raw = storage.namespaces[namespaceId]?.tables?.[tableName];
  return raw instanceof StorageTable ? raw : undefined;
}

/**
 * DDL schema name for a namespace coordinate. Postgres-aware namespaces
 * dispatch to their polymorphic `ddlSchemaName` override; other coordinates
 * flow through unchanged. Mirrors `resolveDdlSchemaForNamespace` in
 * `planner-strategies`, but reads `contract.storage` directly so this resolver
 * does not have to fabricate a full `StrategyContext`.
 */
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
    const table = tableAt(contract.storage, namespaceId, tableName);
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
      if (call.op.target.details?.objectType === 'type') {
        return 'create';
      }
      return 'alter';
    }
    default:
      return 'alter';
  }
}

interface PostgresCallFields {
  readonly schemaName?: string;
  readonly tableName?: string;
  readonly columnName?: string;
  readonly typeName?: string;
}

/**
 * Reads the optional coordinate fields off a call. Each `in` check narrows
 * the discriminated `PostgresOpFactoryCall` union to the members that declare
 * the field, so every access is statically typed — no cast over the union.
 */
function postgresCallFields(call: PostgresOpFactoryCall): PostgresCallFields {
  return {
    ...('schemaName' in call ? { schemaName: call.schemaName } : {}),
    ...('tableName' in call ? { tableName: call.tableName } : {}),
    ...('columnName' in call ? { columnName: call.columnName } : {}),
    ...('typeName' in call ? { typeName: call.typeName } : {}),
  };
}

export function resolvePostgresCallDdlSubject(
  call: PostgresOpFactoryCall,
  contract: Contract<SqlStorage>,
): ResolvedDdlSubject | undefined {
  const intent = postgresCallDdlIntent(call);
  if (intent === null) {
    return undefined;
  }

  const callFields = postgresCallFields(call);

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
      ns && 'enum' in ns && ns.enum != null ? ns.enum[callFields.typeName] : undefined;
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
