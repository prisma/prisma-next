import {
  type Contract,
  type ControlPolicy,
  effectiveControlPolicy,
} from '@prisma-next/contract/types';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  isPostgresEnumStorageEntry,
  type SqlStorage,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import type { FieldEvent, FieldEventContext } from './types';

export type DdlIntent = 'create' | 'alter' | 'drop';

export interface SqlPlannerControlWarning {
  readonly severity: 'warn';
  readonly code: 'control_managed_in_external_space';
  readonly summary: string;
  readonly namespaceId: string;
  readonly table?: string;
  readonly column?: string;
  readonly typeName?: string;
}

const CREATE_ISSUE_KINDS = new Set<SchemaIssue['kind']>([
  'missing_schema',
  'missing_table',
  'missing_column',
  'type_missing',
  'default_missing',
]);

const DROP_ISSUE_KINDS = new Set<SchemaIssue['kind']>([
  'extra_table',
  'extra_column',
  'extra_primary_key',
  'extra_foreign_key',
  'extra_unique_constraint',
  'extra_index',
  'extra_default',
]);

function issueIsMissing(issue: SchemaIssue): boolean {
  if (issue.kind === 'enum_values_changed') return false;
  return issue.actual === undefined;
}

export function schemaIssueDdlIntent(issue: SchemaIssue): DdlIntent | null {
  if (CREATE_ISSUE_KINDS.has(issue.kind)) {
    return 'create';
  }
  if (DROP_ISSUE_KINDS.has(issue.kind)) {
    return 'drop';
  }
  if (
    issue.kind === 'primary_key_mismatch' ||
    issue.kind === 'unique_constraint_mismatch' ||
    issue.kind === 'index_mismatch' ||
    issue.kind === 'foreign_key_mismatch'
  ) {
    return issueIsMissing(issue) ? 'create' : 'alter';
  }
  if (
    issue.kind === 'type_mismatch' ||
    issue.kind === 'nullability_mismatch' ||
    issue.kind === 'default_mismatch' ||
    issue.kind === 'type_values_mismatch' ||
    issue.kind === 'enum_values_changed'
  ) {
    return 'alter';
  }
  return null;
}

export function controlPolicyAllowsDdlIntent(policy: ControlPolicy, intent: DdlIntent): boolean {
  switch (policy) {
    case 'managed':
      return true;
    case 'tolerated':
      return intent === 'create';
    case 'external':
    case 'observed':
      return false;
  }
}

export function resolveNamespaceIdForControl(issue: { readonly namespaceId?: string }): string {
  return issue.namespaceId ?? UNBOUND_NAMESPACE_ID;
}

function tableAt(
  storage: SqlStorage,
  namespaceId: string,
  tableName: string,
): StorageTable | undefined {
  const raw = storage.namespaces[namespaceId]?.tables?.[tableName];
  return raw instanceof StorageTable ? raw : undefined;
}

function locateNamespaceEnum(
  storage: SqlStorage,
  namespaceId: string,
  typeName: string,
): { readonly control?: ControlPolicy } | undefined {
  const ns = storage.namespaces[namespaceId];
  if (!ns || !('enum' in ns) || ns.enum == null) return undefined;
  const entry = ns.enum[typeName];
  return isPostgresEnumStorageEntry(entry) ? entry : undefined;
}

export function resolveControlForSchemaIssue(
  issue: SchemaIssue,
  contract: Contract<SqlStorage>,
): ControlPolicy {
  const defaultControl = contract.defaultControl;

  if (issue.kind === 'missing_schema') {
    return effectiveControlPolicy(undefined, defaultControl);
  }

  if (issue.kind === 'type_missing' && issue.typeName) {
    const namespaceId = resolveNamespaceIdForControl(issue);
    const enumEntry = locateNamespaceEnum(contract.storage, namespaceId, issue.typeName);
    if (enumEntry) {
      return effectiveControlPolicy(enumEntry.control, defaultControl);
    }
    return effectiveControlPolicy(undefined, defaultControl);
  }

  if ('table' in issue && typeof issue.table === 'string') {
    const namespaceId = resolveNamespaceIdForControl(issue);
    const table = tableAt(contract.storage, namespaceId, issue.table);
    return effectiveControlPolicy(table?.control, defaultControl);
  }

  return effectiveControlPolicy(undefined, defaultControl);
}

function explicitNodeControlForIssue(
  issue: SchemaIssue,
  contract: Contract<SqlStorage>,
): ControlPolicy | undefined {
  if (issue.kind === 'type_missing' && issue.typeName) {
    const namespaceId = resolveNamespaceIdForControl(issue);
    const enumEntry = locateNamespaceEnum(contract.storage, namespaceId, issue.typeName);
    return enumEntry?.control;
  }
  if ('table' in issue && typeof issue.table === 'string') {
    const namespaceId = resolveNamespaceIdForControl(issue);
    return tableAt(contract.storage, namespaceId, issue.table)?.control;
  }
  return undefined;
}

export function warningForSuppressedSchemaIssue(
  issue: SchemaIssue,
  contract: Contract<SqlStorage>,
): SqlPlannerControlWarning | undefined {
  if (contract.defaultControl !== 'external') {
    return undefined;
  }
  const intent = schemaIssueDdlIntent(issue);
  if (intent === null) {
    return undefined;
  }
  const explicitControl = explicitNodeControlForIssue(issue, contract);
  if (explicitControl !== 'managed') {
    return undefined;
  }
  if (!controlPolicyAllowsDdlIntent('managed', intent)) {
    return undefined;
  }
  const namespaceId = resolveNamespaceIdForControl(issue);
  const subject: ResolvedDdlSubject = {
    namespaceId,
    intent,
    explicitNodeControl: explicitControl,
    ...('table' in issue && typeof issue.table === 'string' ? { table: issue.table } : {}),
    ...('column' in issue && typeof issue.column === 'string' ? { column: issue.column } : {}),
    ...(issue.typeName !== undefined ? { typeName: issue.typeName } : {}),
  };
  return controlWarningForSubject(subject);
}

export function shouldEmitSchemaIssue(issue: SchemaIssue, contract: Contract<SqlStorage>): boolean {
  const intent = schemaIssueDdlIntent(issue);
  if (intent === null) {
    return false;
  }
  if (contract.defaultControl === 'external') {
    return false;
  }
  const control = resolveControlForSchemaIssue(issue, contract);
  return controlPolicyAllowsDdlIntent(control, intent);
}

function fieldEventDdlIntent(event: FieldEvent): DdlIntent {
  switch (event) {
    case 'added':
      return 'create';
    case 'dropped':
      return 'drop';
    case 'altered':
      return 'alter';
  }
}

export function shouldEmitFieldEvent(
  event: FieldEvent,
  ctx: FieldEventContext,
  contract: Contract<SqlStorage>,
): boolean {
  if (contract.defaultControl === 'external') {
    return false;
  }
  const table = ctx.newTable ?? ctx.priorTable;
  const control = effectiveControlPolicy(table?.control, contract.defaultControl);
  return controlPolicyAllowsDdlIntent(control, fieldEventDdlIntent(event));
}

export interface ResolvedDdlSubject {
  readonly namespaceId: string;
  readonly intent: DdlIntent;
  readonly explicitNodeControl?: ControlPolicy;
  readonly table?: string;
  readonly column?: string;
  readonly typeName?: string;
}

export interface GateCallsByControlPolicyOptions<TCall> {
  readonly calls: readonly TCall[];
  readonly contract: Contract<SqlStorage>;
  readonly resolveSubject: (call: TCall) => ResolvedDdlSubject | undefined;
}

export interface GateCallsByControlPolicyResult<TCall> {
  readonly calls: readonly TCall[];
  readonly warnings: readonly SqlPlannerControlWarning[];
}

function controlWarningForSubject(subject: ResolvedDdlSubject): SqlPlannerControlWarning {
  const objectLabel =
    subject.table !== undefined
      ? subject.column !== undefined
        ? `table "${subject.table}" column "${subject.column}"`
        : `table "${subject.table}"`
      : subject.typeName !== undefined
        ? `type "${subject.typeName}"`
        : `namespace "${subject.namespaceId}"`;
  return Object.freeze({
    severity: 'warn',
    code: 'control_managed_in_external_space',
    summary: `Object ${objectLabel} declares control "managed" but the contract default is "external"; migration DDL for it was suppressed.`,
    namespaceId: subject.namespaceId,
    ...(subject.table !== undefined ? { table: subject.table } : {}),
    ...(subject.column !== undefined ? { column: subject.column } : {}),
    ...(subject.typeName !== undefined ? { typeName: subject.typeName } : {}),
  });
}

export function gateCallsByControlPolicy<TCall>(
  options: GateCallsByControlPolicyOptions<TCall>,
): GateCallsByControlPolicyResult<TCall> {
  const defaultControl = options.contract.defaultControl;
  const externalFloor = defaultControl === 'external';
  const kept: TCall[] = [];
  const warnings: SqlPlannerControlWarning[] = [];
  const warnedKeys = new Set<string>();

  for (const call of options.calls) {
    const subject = options.resolveSubject(call);
    if (subject === undefined) {
      kept.push(call);
      continue;
    }

    const policy = effectiveControlPolicy(subject.explicitNodeControl, defaultControl);
    const managedOverrideInExternalSpace =
      externalFloor && subject.explicitNodeControl === 'managed';

    if (externalFloor) {
      if (managedOverrideInExternalSpace) {
        const warnKey = `${subject.namespaceId}\0${subject.table ?? ''}\0${subject.column ?? ''}\0${subject.typeName ?? ''}`;
        if (!warnedKeys.has(warnKey)) {
          warnedKeys.add(warnKey);
          warnings.push(controlWarningForSubject(subject));
        }
      }
      continue;
    }

    if (!controlPolicyAllowsDdlIntent(policy, subject.intent)) {
      continue;
    }

    kept.push(call);
  }

  return Object.freeze({
    calls: Object.freeze(kept),
    warnings: Object.freeze(warnings),
  });
}
