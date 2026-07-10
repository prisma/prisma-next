import type { Contract, ControlPolicy } from '@prisma-next/contract/types';
import type { ControlPolicySubject } from '@prisma-next/family-sql/control';
import type { SchemaDiffIssue } from '@prisma-next/framework-components/control';
import { entityAt, UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { isPostgresSchema } from '../postgres-schema';
import type { PostgresNamespaceSchemaNode } from '../schema-ir/postgres-namespace-schema-node';
import type { PostgresNativeEnumSchemaNode } from '../schema-ir/postgres-native-enum-schema-node';
import { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import type { SqlSchemaDiffNode } from '../schema-ir/schema-node-kinds';
import { PostgresSchemaNodeKind } from '../schema-ir/schema-node-kinds';
import { issueColumnName } from './issue-planner';
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
  'createSchema',
  'createNativeEnumType',
  'createRlsPolicy',
  'enableRowLevelSecurity',
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
    const table = entityAt<StorageTable>(contract.storage, {
      namespaceId,
      entityKind: 'table',
      entityName: tableName,
    });
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

export function resolveNamespaceIdForDdlSchema(
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
}

function postgresCallFields(call: PostgresOpFactoryCall): PostgresCallFields {
  return {
    ...ifDefined('schemaName', 'schemaName' in call ? call.schemaName : undefined),
    ...ifDefined('tableName', 'tableName' in call ? call.tableName : undefined),
    ...ifDefined('columnName', 'columnName' in call ? call.columnName : undefined),
  };
}

export function formatPostgresControlPolicySubjectLabel(
  factoryName: string,
  subject: ControlPolicySubject | undefined,
  contract: Contract<SqlStorage>,
): string {
  if (subject?.table) {
    const ddlSchema = ddlSchemaNameForNamespace(contract, subject.namespaceId);
    return `${factoryName}(${ddlSchema}.${subject.table})`;
  }
  return factoryName;
}

/**
 * The declared control grade of the native enum entity whose PHYSICAL type
 * name matches, in the given namespace. `entries.native_enum` is keyed by
 * handle name while calls carry the type name, so `entityAt` cannot address
 * the entity — this walks the kind map matching on the entity's `typeName`
 * field, the same type-name matching `contract infer`'s pack subtraction
 * uses.
 */
function nativeEnumControlByTypeName(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  typeName: string,
): ControlPolicy | undefined {
  const namespace = contract.storage.namespaces[namespaceId];
  if (!isPostgresSchema(namespace)) return undefined;
  for (const entity of Object.values(namespace.entries.native_enum ?? {})) {
    if (entity.typeName === typeName) return entity.control;
  }
  return undefined;
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

  if (
    (call.factoryName === 'createNativeEnumType' || call.factoryName === 'dropNativeEnumType') &&
    'typeName' in call &&
    'schemaName' in call
  ) {
    const namespaceId = resolveNamespaceIdForDdlSchema(contract, call.schemaName);
    return {
      namespaceId,
      ...ifDefined(
        'explicitNodeControlPolicy',
        nativeEnumControlByTypeName(contract, namespaceId, call.typeName),
      ),
      typeName: call.typeName,
      createsNewObject,
    };
  }

  if (callFields.tableName) {
    const namespaceId = resolveNamespaceIdForTable(
      contract,
      callFields.tableName,
      callFields.schemaName,
    );
    const tableControlPolicy = entityAt<StorageTable>(contract.storage, {
      namespaceId,
      entityKind: 'table',
      entityName: callFields.tableName,
    })?.control;
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

/**
 * Node kinds that describe the absence of a whole, top-level Postgres
 * object — the same objects `createsNewTopLevelObject` recognises for calls.
 * Used by {@link resolvePostgresNodeIssueCreationFactoryName} to decide
 * whether a `tolerated` subject permits the issue to flow into the planner
 * (create-if-absent) and to seed the suppressed-subject warning's
 * `factoryName` when the planner is skipped. RLS policy creation is not
 * listed here — policy issues never reach this issue-based partition (they
 * are routed to `planPostgresSchemaDiff` and gated via the call-based
 * {@link resolvePostgresCallControlPolicySubject} instead).
 */
const POSTGRES_NODE_CREATION_FACTORY: Readonly<Record<string, string>> = Object.freeze({
  [PostgresSchemaNodeKind.namespace]: 'createSchema',
  [PostgresSchemaNodeKind.table]: 'createTable',
  [PostgresSchemaNodeKind.nativeEnum]: 'createNativeEnumType',
});

/**
 * A table `not-equal` issue whose `rlsEnabled` flips OFF→ON (expected on,
 * actual off) is enablement toward `ENABLE ROW LEVEL SECURITY` —
 * creation-class per `OBJECT_CREATION_FACTORIES` ('enableRowLevelSecurity'
 * is a member): enabling RLS establishes the fail-closed guard the declared
 * policy set attaches to, the same grant `tolerated` extends to creating the
 * policies themselves. The opposite direction (`DISABLE`) is a modification
 * and stays managed-only. Keying on the actual delta (not just the expected
 * bit) keeps this correct if a second table attribute ever joins
 * `isEqualTo`: a not-equal with no `rlsEnabled` delta is not enablement, so
 * it is not admitted as creation-class here.
 */
function isEnablementCreationIssue(issue: SchemaDiffIssue<SqlSchemaDiffNode>): boolean {
  if (issue.reason !== 'not-equal') return false;
  const { expected, actual } = issue;
  return (
    expected !== undefined &&
    actual !== undefined &&
    PostgresTableSchemaNode.is(expected) &&
    PostgresTableSchemaNode.is(actual) &&
    expected.rlsEnabled === true &&
    actual.rlsEnabled === false
  );
}

export function resolvePostgresNodeIssueCreationFactoryName(
  issue: SchemaDiffIssue<SqlSchemaDiffNode>,
): string | undefined {
  if (isEnablementCreationIssue(issue)) {
    return 'enableRowLevelSecurity';
  }
  if (issue.reason !== 'not-found') return undefined;
  const node = issue.expected ?? issue.actual;
  if (node === undefined) return undefined;
  return POSTGRES_NODE_CREATION_FACTORY[node.nodeKind];
}

/**
 * Resolve the control-policy subject coordinate for a single node-typed
 * {@link SchemaDiffIssue}. Mirrors the resolution
 * `resolvePostgresCallControlPolicySubject` performs for a generated DDL
 * call, but works *off the issue* — so the planner can partition issues by
 * effective policy before the diff engine runs. `createsNewObject` is
 * derived from the node kind + reason: a `not-found` schema/table describes
 * a brand-new top-level object; everything else touches an existing object.
 *
 * A `not-expected` table carries no contract namespace coordinate (the live
 * table isn't claimed by any contract namespace), so the subject's
 * `namespaceId` falls back to {@link UNBOUND_NAMESPACE_ID} via
 * `resolveNamespaceIdForTable`'s own fallback — the call-side resolver does
 * the same for the `DropTableCall` it produces.
 */
export function resolvePostgresNodeIssueControlPolicySubject(
  issue: SchemaDiffIssue<SqlSchemaDiffNode>,
  contract: Contract<SqlStorage>,
): ControlPolicySubject | undefined {
  const node = issue.expected ?? issue.actual;
  if (node === undefined) return undefined;

  if (node.nodeKind === PostgresSchemaNodeKind.namespace) {
    const namespaceNode = blindCast<
      PostgresNamespaceSchemaNode,
      'a postgres-namespace diff node is always a PostgresNamespaceSchemaNode'
    >(node);
    return {
      namespaceId: resolveNamespaceIdForDdlSchema(contract, namespaceNode.schemaName),
      createsNewObject: issue.reason === 'not-found',
    };
  }

  if (node.nodeKind === PostgresSchemaNodeKind.nativeEnum) {
    const enumNode = blindCast<
      PostgresNativeEnumSchemaNode,
      'a postgres-native-enum diff node is always a PostgresNativeEnumSchemaNode'
    >(node);
    // The entity's grade rides on the expected-side node (entries.native_enum
    // is keyed by handle name while the node only knows the Postgres type
    // name, so `entityAt` cannot address the entity). A `not-expected` enum
    // has no expected node and no contract entity — the grade falls back to
    // the contract default, like an undeclared live table.
    const expectedControl =
      issue.expected !== undefined
        ? blindCast<
            PostgresNativeEnumSchemaNode,
            'the expected side of a postgres-native-enum issue is the projected enum node'
          >(issue.expected).control
        : undefined;
    return {
      namespaceId: resolveNamespaceIdForDdlSchema(contract, issue.path[1] ?? enumNode.namespaceId),
      ...ifDefined('explicitNodeControlPolicy', expectedControl),
      typeName: enumNode.typeName,
      createsNewObject: issue.reason === 'not-found',
    };
  }

  const tableName = issue.path[2];
  if (tableName === undefined) return undefined;
  const ddlSchemaName = issue.path[1];
  const namespaceId = resolveNamespaceIdForTable(contract, tableName, ddlSchemaName);
  const table = entityAt<StorageTable>(contract.storage, {
    namespaceId,
    entityKind: 'table',
    entityName: tableName,
  });
  const createsNewObject =
    (node.nodeKind === PostgresSchemaNodeKind.table && issue.reason === 'not-found') ||
    isEnablementCreationIssue(issue);

  return {
    namespaceId,
    ...ifDefined('explicitNodeControlPolicy', table?.control),
    table: tableName,
    ...ifDefined('column', issueColumnName(issue)),
    createsNewObject,
  };
}
