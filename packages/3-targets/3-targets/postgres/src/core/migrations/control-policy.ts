import type { Contract, ControlPolicy } from '@prisma-next/contract/types';
import type {
  ControlPolicySubject,
  SqlPlannerConflict,
  SuppressionRecord,
} from '@prisma-next/family-sql/control';
import type { SchemaDiffIssue } from '@prisma-next/framework-components/control';
import { entityAt, UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import type { PostgresNativeEnum } from '../postgres-native-enum';
import { isPostgresSchema } from '../postgres-schema';
import { postgresNodeStorageCoordinate } from '../schema-ir/node-storage-coordinate';
import type { PostgresNamespaceSchemaNode } from '../schema-ir/postgres-namespace-schema-node';
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

/**
 * Resolve the namespace a declared storage entity lives in by walking every
 * namespace for one whose `entries` map actually contains the coordinate —
 * a table by its name, a native enum by its physical type name (see
 * {@link postgresNodeStorageCoordinate}). When `ddlSchemaName` is given, the
 * match must also land in that DDL schema (disambiguates same-named entities
 * declared under different namespaces); when omitted, the first namespace
 * that declares the entity wins. Falls back to {@link UNBOUND_NAMESPACE_ID}
 * when no namespace declares it — e.g. an extra/dropped entity the contract
 * doesn't claim at all.
 */
function resolveNamespaceIdForEntity(
  contract: Contract<SqlStorage>,
  coordinate: { readonly entityKind: string; readonly entityName: string },
  ddlSchemaName: string | undefined,
): string {
  for (const namespaceId of Object.keys(contract.storage.namespaces)) {
    const entity = entityAt(contract.storage, { namespaceId, ...coordinate });
    if (!entity) continue;
    if (
      ddlSchemaName === undefined ||
      ddlSchemaNameForNamespace(contract, namespaceId) === ddlSchemaName
    ) {
      return namespaceId;
    }
  }
  return UNBOUND_NAMESPACE_ID;
}

function resolveNamespaceIdForTable(
  contract: Contract<SqlStorage>,
  tableName: string,
  ddlSchemaName: string | undefined,
): string {
  return resolveNamespaceIdForEntity(
    contract,
    { entityKind: 'table', entityName: tableName },
    ddlSchemaName,
  );
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

function formatSuppressionSubjectLabel(
  subject: ControlPolicySubject | undefined,
  contract: Contract<SqlStorage>,
): string {
  if (subject === undefined) return 'unknown';
  const ddlSchema = ddlSchemaNameForNamespace(contract, subject.namespaceId);
  if (subject.entityKind !== undefined && subject.entityName !== undefined) {
    return `${subject.entityKind} "${ddlSchema}.${subject.entityName}"`;
  }
  return `namespace "${ddlSchema}"`;
}

function postgresSuppressionSummary(
  subjectLabel: string,
  subject: ControlPolicySubject | undefined,
  policy: string,
): string {
  const namespace = subject?.namespaceId ?? 'unknown';
  const declared = subject?.explicitNodeControlPolicy;
  if (policy === 'external' && declared === 'managed') {
    return `control policy suppressed: ${subjectLabel} — namespace '${namespace}' has effective control 'external' but declared 'managed'`;
  }
  const declaredSuffix = declared ? ` but declared '${declared}'` : '';
  return `control policy suppressed: ${subjectLabel} — namespace '${namespace}' has effective control '${policy}'${declaredSuffix}`;
}

/**
 * Render one family {@link SuppressionRecord} into a target `SqlPlannerConflict`.
 * The family decides *that* a subject is suppressed and hands over the raw
 * coordinate + policy; the label, message, and location are rendered here,
 * driven entirely by the subject's own `(entityKind, entityName)` coordinate
 * — no target-owned table-vs-enum vocabulary.
 */
export function renderPostgresSuppression(
  record: SuppressionRecord,
  contract: Contract<SqlStorage>,
): SqlPlannerConflict {
  const subject = record.subject;
  const subjectLabel = formatSuppressionSubjectLabel(subject, contract);
  return {
    kind: 'controlPolicySuppressedCall',
    summary: postgresSuppressionSummary(subjectLabel, subject, record.policy),
    location: {
      ...ifDefined('namespace', subject?.namespaceId),
      ...ifDefined('table', subject?.entityKind === 'table' ? subject.entityName : undefined),
      ...ifDefined('column', subject?.column),
      ...ifDefined('type', subject?.entityKind === 'native_enum' ? subject.entityName : undefined),
    },
    meta: {
      controlPolicy: record.policy,
      ...ifDefined('factoryName', record.factoryName),
      ...ifDefined('declaredControlPolicy', subject?.explicitNodeControlPolicy),
    },
  };
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
    const enumControl = entityAt<PostgresNativeEnum>(contract.storage, {
      namespaceId,
      entityKind: 'native_enum',
      entityName: call.typeName,
    })?.control;
    return {
      namespaceId,
      entityKind: 'native_enum',
      entityName: call.typeName,
      ...ifDefined('explicitNodeControlPolicy', enumControl),
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
      entityKind: 'table',
      entityName: callFields.tableName,
      ...ifDefined('column', callFields.columnName),
      ...ifDefined('explicitNodeControlPolicy', tableControlPolicy),
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
 * effective policy before the diff engine runs.
 *
 * A whole storage entity (table or native enum) resolves generically off
 * {@link postgresNodeStorageCoordinate} — the node self-describes its
 * `(entityKind, entityName)`, so table and enum issues share one code path
 * with no per-kind branch. A sub-entity issue (a column/constraint drift
 * inside an owned table) carries no such coordinate on its own node, so it
 * falls back to reading the enclosing table name off the issue path.
 *
 * `createsNewObject` is delegated to {@link resolvePostgresNodeIssueCreationFactoryName}
 * in every branch below — that function already encodes exactly which
 * node-kind/reason combinations describe a brand-new top-level object
 * (a `not-found` table/enum, or an RLS-enablement `not-equal`).
 *
 * A `not-expected` (extra/dropped) entity carries no contract namespace
 * coordinate — the live object isn't claimed by any contract namespace — so
 * the subject's `namespaceId` falls back to {@link UNBOUND_NAMESPACE_ID} via
 * `resolveNamespaceIdForEntity`'s own fallback, matching how the call-side
 * resolver treats the `DropTableCall`/`DropNativeEnumTypeCall` it produces.
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

  const coordinate = postgresNodeStorageCoordinate(node);
  if (coordinate !== undefined) {
    const namespaceId = resolveNamespaceIdForEntity(contract, coordinate, issue.path[1]);
    const entityControl = entityAt<{ readonly control?: ControlPolicy }>(contract.storage, {
      namespaceId,
      ...coordinate,
    })?.control;
    return {
      namespaceId,
      ...coordinate,
      ...ifDefined('column', issueColumnName(issue)),
      ...ifDefined('explicitNodeControlPolicy', entityControl),
      createsNewObject: resolvePostgresNodeIssueCreationFactoryName(issue) !== undefined,
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

  return {
    namespaceId,
    entityKind: 'table',
    entityName: tableName,
    ...ifDefined('column', issueColumnName(issue)),
    ...ifDefined('explicitNodeControlPolicy', table?.control),
    createsNewObject: resolvePostgresNodeIssueCreationFactoryName(issue) !== undefined,
  };
}
