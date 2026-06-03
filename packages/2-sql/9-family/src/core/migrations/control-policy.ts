import {
  type Contract,
  type ControlPolicy,
  effectiveControlPolicy,
} from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlPlannerConflict } from './types';

/**
 * The target object a control policy governs for a single planner call,
 * resolved from the target's own IR. `undefined` means the call's target
 * object could not be positively established — a fail-closed signal: any
 * policy stricter than `managed` drops such a call rather than emitting it.
 */
export interface ControlPolicySubject {
  readonly namespaceId: string;
  readonly explicitNodeControlPolicy?: ControlPolicy;
  readonly table?: string;
  readonly column?: string;
  readonly typeName?: string;
  /**
   * Whether the call creates a whole, previously-absent top-level storage
   * object (e.g. a table or an enum/type), as opposed to modifying an
   * existing object. This is the only thing `tolerated` permits: it is a
   * create-if-absent policy, so an op that touches an existing object — add
   * column, add index/constraint, alter, drop — is never allowed under it.
   */
  readonly createsNewObject: boolean;
}

/**
 * The control policy that governs a single call. The `external` default is an
 * un-overridable namespace floor: when the contract default is `external`, no
 * per-object `managed` override can escalate DDL above the floor, so the
 * policy is forced to `external` regardless of the node's own declaration.
 * Every other default defers to the node's effective control policy.
 */
export function controlPolicyForCall(
  subject: ControlPolicySubject | undefined,
  defaultControlPolicy: ControlPolicy | undefined,
): ControlPolicy {
  if (defaultControlPolicy === 'external') {
    return 'external';
  }
  return effectiveControlPolicy(subject?.explicitNodeControlPolicy, defaultControlPolicy);
}

/**
 * Whether a call is allowed to emit under a given control policy.
 *
 * - `managed` — full lifecycle, every op allowed.
 * - `tolerated` — create-if-absent only: allowed iff the call creates a whole
 *   new top-level object (and its subject was positively resolved). Anything
 *   that modifies an existing object, and anything whose subject could not be
 *   resolved, is suppressed.
 * - `external` / `observed` — no DDL at all.
 */
function callAllowedUnderControlPolicy(
  policy: ControlPolicy,
  subject: ControlPolicySubject | undefined,
): boolean {
  switch (policy) {
    case 'managed':
      return true;
    case 'tolerated':
      return subject?.createsNewObject === true;
    case 'external':
    case 'observed':
      return false;
  }
}

function defaultTargetRef(factoryName: string, subject: ControlPolicySubject | undefined): string {
  if (subject?.table) {
    return `${factoryName}(${subject.table})`;
  }
  if (subject?.typeName) {
    return `${factoryName}(${subject.typeName})`;
  }
  return factoryName;
}

function suppressionSummary(
  targetRef: string,
  subject: ControlPolicySubject | undefined,
  effectivePolicy: ControlPolicy,
): string {
  const namespace = subject?.namespaceId ?? 'unknown';
  const declared = subject?.explicitNodeControlPolicy;
  if (effectivePolicy === 'external' && declared === 'managed') {
    return `control policy suppressed: ${targetRef} — namespace '${namespace}' has effective control 'external' but table declared 'managed'`;
  }
  const declaredSuffix = declared ? ` but table declared '${declared}'` : '';
  return `control policy suppressed: ${targetRef} — namespace '${namespace}' has effective control '${effectivePolicy}'${declaredSuffix}`;
}

function buildSuppressionWarning<TCall>(
  call: TCall,
  subject: ControlPolicySubject | undefined,
  effectivePolicy: ControlPolicy,
  resolveFactoryName: (call: TCall) => string,
  formatTargetRef: (factoryName: string, subject: ControlPolicySubject | undefined) => string,
): SqlPlannerConflict {
  const factoryName = resolveFactoryName(call);
  const targetRef = formatTargetRef(factoryName, subject);
  return {
    kind: 'controlPolicySuppressedCall',
    summary: suppressionSummary(targetRef, subject, effectivePolicy),
    location: {
      ...(subject?.namespaceId ? { namespace: subject.namespaceId } : {}),
      ...(subject?.table ? { table: subject.table } : {}),
      ...(subject?.column ? { column: subject.column } : {}),
      ...(subject?.typeName ? { type: subject.typeName } : {}),
    },
    meta: {
      controlPolicy: effectivePolicy,
      factoryName,
      ...(subject?.explicitNodeControlPolicy
        ? { declaredControlPolicy: subject.explicitNodeControlPolicy }
        : {}),
    },
  };
}

export function partitionCallsByControlPolicy<TCall>(options: {
  readonly calls: readonly TCall[];
  readonly contract: Contract<SqlStorage>;
  readonly resolveControlPolicySubject: (call: TCall) => ControlPolicySubject | undefined;
  readonly resolveFactoryName: (call: TCall) => string;
  readonly formatTargetRef?: (
    factoryName: string,
    subject: ControlPolicySubject | undefined,
  ) => string;
}): {
  readonly kept: readonly TCall[];
  readonly warnings: readonly SqlPlannerConflict[];
} {
  const defaultControlPolicy = options.contract.defaultControlPolicy;
  const formatTargetRef = options.formatTargetRef ?? defaultTargetRef;
  const kept: TCall[] = [];
  const warnings: SqlPlannerConflict[] = [];

  for (const call of options.calls) {
    const subject = options.resolveControlPolicySubject(call);
    const policy = controlPolicyForCall(subject, defaultControlPolicy);
    if (callAllowedUnderControlPolicy(policy, subject)) {
      kept.push(call);
    } else {
      warnings.push(
        buildSuppressionWarning(call, subject, policy, options.resolveFactoryName, formatTargetRef),
      );
    }
  }

  return Object.freeze({
    kept: Object.freeze(kept),
    warnings: Object.freeze(warnings),
  });
}

export function filterCallsByControlPolicy<TCall>(options: {
  readonly calls: readonly TCall[];
  readonly contract: Contract<SqlStorage>;
  readonly resolveControlPolicySubject: (call: TCall) => ControlPolicySubject | undefined;
}): readonly TCall[] {
  const defaultControlPolicy = options.contract.defaultControlPolicy;
  const kept: TCall[] = [];

  for (const call of options.calls) {
    const subject = options.resolveControlPolicySubject(call);
    const policy = controlPolicyForCall(subject, defaultControlPolicy);
    if (callAllowedUnderControlPolicy(policy, subject)) {
      kept.push(call);
    }
  }

  return Object.freeze(kept);
}
