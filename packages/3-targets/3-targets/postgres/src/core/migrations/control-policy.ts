import type { Contract } from '@prisma-next/contract/types';
import type { ControlPolicySubject } from '@prisma-next/family-sql/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  isPostgresEnumStorageEntry,
  type SqlStorage,
  storageTableAt,
} from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { isPostgresSchema } from '../postgres-schema';
import type { PostgresOpFactoryCall } from './op-factory-call';

/**
 * Factory calls that create a whole, previously-absent top-level storage
 * object. Used to decide whether `tolerated` permits a call (it only allows
 * creating absent objects, never modifying existing ones).
 *
 * Deliberately an explicit, closed set rather than a `factoryName`
 * create/alter/drop classification: it answers exactly one yes/no question
 * and is fail-closed. Any call not listed here — including future or
 * extension-contributed factories — is treated as NOT object-creation, so it
 * is suppressed under `tolerated` rather than permissively emitted.
 */
const OBJECT_CREATION_FACTORIES: ReadonlySet<string> = new Set<string>([
  'createTable',
  'createEnumType',
  'createSchema',
]);

function createsNewTopLevelObject(call: PostgresOpFactoryCall): boolean {
  return OBJECT_CREATION_FACTORIES.has(call.factoryName);
}

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
    ...ifDefined('schemaName', 'schemaName' in call ? call.schemaName : undefined),
    ...ifDefined('tableName', 'tableName' in call ? call.tableName : undefined),
    ...ifDefined('columnName', 'columnName' in call ? call.columnName : undefined),
    ...ifDefined('typeName', 'typeName' in call ? call.typeName : undefined),
  };
}

export function formatPostgresControlPolicyTargetRef(
  factoryName: string,
  subject: ControlPolicySubject | undefined,
  contract: Contract<SqlStorage>,
): string {
  if (subject?.table) {
    const ddlSchema = ddlSchemaNameForNamespace(contract, subject.namespaceId);
    return `${factoryName}(${ddlSchema}.${subject.table})`;
  }
  if (subject?.typeName) {
    const ddlSchema = ddlSchemaNameForNamespace(contract, subject.namespaceId);
    return `${factoryName}(${ddlSchema}.${subject.typeName})`;
  }
  return factoryName;
}

export function resolvePostgresCallControlPolicySubject(
  call: PostgresOpFactoryCall,
  contract: Contract<SqlStorage>,
): ControlPolicySubject | undefined {
  const callFields = postgresCallFields(call);
  const createsNewObject = createsNewTopLevelObject(call);

  if (call.factoryName === 'createSchema' && callFields.schemaName) {
    return {
      namespaceId: resolveNamespaceIdForDdlSchema(contract, callFields.schemaName),
      createsNewObject,
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
      ...ifDefined('explicitNodeControlPolicy', controlPolicy),
      typeName: callFields.typeName,
      createsNewObject,
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
      ...ifDefined('explicitNodeControlPolicy', tableControlPolicy),
      table: callFields.tableName,
      ...ifDefined('column', callFields.columnName),
      createsNewObject,
    };
  }

  if (callFields.schemaName) {
    return {
      namespaceId: resolveNamespaceIdForDdlSchema(contract, callFields.schemaName),
      createsNewObject,
    };
  }

  return undefined;
}
