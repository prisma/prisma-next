import {
  type Contract,
  type ControlPolicy,
  effectiveControlPolicy,
} from '@prisma-next/contract/types';
import type {
  MigrationOperationClass,
  OpFactoryCall,
  SchemaIssue,
} from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  isPostgresEnumStorageEntry,
  type SqlStorage,
  storageTableAt,
} from '@prisma-next/sql-contract/types';

const ALL_OPERATION_CLASSES: readonly MigrationOperationClass[] = [
  'additive',
  'widening',
  'destructive',
  'data',
];

export function controlPolicyAllowedOperationClasses(
  policy: ControlPolicy,
): readonly MigrationOperationClass[] {
  switch (policy) {
    case 'managed':
      return ALL_OPERATION_CLASSES;
    case 'tolerated':
      return ['additive'];
    case 'external':
    case 'observed':
      return [];
  }
}

export function resolveNamespaceId(issue: { readonly namespaceId?: string }): string {
  return issue.namespaceId ?? UNBOUND_NAMESPACE_ID;
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

export function resolveControlPolicyForSchemaIssue(
  issue: SchemaIssue,
  contract: Contract<SqlStorage>,
): ControlPolicy {
  const defaultControl = contract.defaultControl;

  if (issue.kind === 'missing_schema') {
    return effectiveControlPolicy(undefined, defaultControl);
  }

  if (issue.kind === 'type_missing' && issue.typeName) {
    const namespaceId = resolveNamespaceId(issue);
    const enumEntry = locateNamespaceEnum(contract.storage, namespaceId, issue.typeName);
    if (enumEntry) {
      return effectiveControlPolicy(enumEntry.control, defaultControl);
    }
    return effectiveControlPolicy(undefined, defaultControl);
  }

  if ('table' in issue && typeof issue.table === 'string') {
    const namespaceId = resolveNamespaceId(issue);
    const table = storageTableAt(contract.storage, namespaceId, issue.table);
    return effectiveControlPolicy(table?.control, defaultControl);
  }

  return effectiveControlPolicy(undefined, defaultControl);
}

export interface ResolvedControlSubject {
  readonly namespaceId: string;
  readonly explicitNodeControlPolicy?: ControlPolicy;
  readonly table?: string;
  readonly column?: string;
  readonly typeName?: string;
}

export function filterCallsByControlPolicy<TCall extends OpFactoryCall>(options: {
  readonly calls: readonly TCall[];
  readonly contract: Contract<SqlStorage>;
  readonly resolveSubject: (call: TCall) => ResolvedControlSubject | undefined;
}): readonly TCall[] {
  const defaultControl = options.contract.defaultControl;
  const externalFloor = defaultControl === 'external';
  const kept: TCall[] = [];

  for (const call of options.calls) {
    if (externalFloor) {
      continue;
    }

    const subject = options.resolveSubject(call);
    if (subject === undefined) {
      kept.push(call);
      continue;
    }

    const policy = effectiveControlPolicy(subject.explicitNodeControlPolicy, defaultControl);
    const allowed = controlPolicyAllowedOperationClasses(policy);
    if (allowed.includes(call.operationClass)) {
      kept.push(call);
    }
  }

  return Object.freeze(kept);
}
