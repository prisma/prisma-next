import {
  type Contract,
  type ControlPolicy,
  effectiveControlPolicy,
} from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
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

function defaultSubjectLabel(
  factoryName: string,
  subject: ControlPolicySubject | undefined,
): string {
  if (subject?.table) {
    return `${factoryName}(${subject.table})`;
  }
  if (subject?.typeName) {
    return `${factoryName}(${subject.typeName})`;
  }
  return factoryName;
}

function suppressionSummary(
  subjectLabel: string,
  subject: ControlPolicySubject | undefined,
  effectivePolicy: ControlPolicy,
): string {
  const namespace = subject?.namespaceId ?? 'unknown';
  const declared = subject?.explicitNodeControlPolicy;
  if (effectivePolicy === 'external' && declared === 'managed') {
    return `control policy suppressed: ${subjectLabel} — namespace '${namespace}' has effective control 'external' but table declared 'managed'`;
  }
  const declaredSuffix = declared ? ` but table declared '${declared}'` : '';
  return `control policy suppressed: ${subjectLabel} — namespace '${namespace}' has effective control '${effectivePolicy}'${declaredSuffix}`;
}

function buildSubjectSuppressionWarning(
  subject: ControlPolicySubject | undefined,
  effectivePolicy: ControlPolicy,
  factoryName: string,
  formatSubjectLabel: (factoryName: string, subject: ControlPolicySubject | undefined) => string,
): SqlPlannerConflict {
  const subjectLabel = formatSubjectLabel(factoryName, subject);
  return {
    kind: 'controlPolicySuppressedCall',
    summary: suppressionSummary(subjectLabel, subject, effectivePolicy),
    location: {
      ...ifDefined('namespace', subject?.namespaceId),
      ...ifDefined('table', subject?.table),
      ...ifDefined('column', subject?.column),
      ...ifDefined('type', subject?.typeName),
    },
    meta: {
      controlPolicy: effectivePolicy,
      factoryName,
      ...ifDefined('declaredControlPolicy', subject?.explicitNodeControlPolicy),
    },
  };
}

function defaultModificationFactoryNameForSubject(subject: ControlPolicySubject): string {
  if (subject.table) return 'alterTable';
  if (subject.typeName) return 'alterType';
  return 'alterSchema';
}

/**
 * Partition the calls produced for a single set of subjects into those the
 * effective control policy permits (`kept`) and a list of
 * {@link SqlPlannerConflict} warnings describing the suppressed calls.
 *
 * **Prefer {@link partitionIssuesByControlPolicy}** for the schema-issue
 * pipeline: it filters subjects out of the planner's *input* so the planner
 * never has to reason about un-modeled state on `external`/`observed`
 * subjects. This call-level helper remains for paths that bypass the issue
 * pipeline — currently the codec-emitted field-event ops, which originate
 * from declared contract fields rather than from introspected schema state
 * and therefore cannot trip the diff engine.
 */
export function partitionCallsByControlPolicy<TCall>(options: {
  readonly calls: readonly TCall[];
  readonly contract: Contract<SqlStorage>;
  readonly resolveControlPolicySubject: (call: TCall) => ControlPolicySubject | undefined;
  readonly resolveFactoryName: (call: TCall) => string;
  readonly formatSubjectLabel?: (
    factoryName: string,
    subject: ControlPolicySubject | undefined,
  ) => string;
}): {
  readonly kept: readonly TCall[];
  readonly warnings: readonly SqlPlannerConflict[];
} {
  const defaultControlPolicy = options.contract.defaultControlPolicy;
  const formatSubjectLabel = options.formatSubjectLabel ?? defaultSubjectLabel;
  const kept: TCall[] = [];
  const warnings: SqlPlannerConflict[] = [];

  for (const call of options.calls) {
    const subject = options.resolveControlPolicySubject(call);
    const policy = controlPolicyForCall(subject, defaultControlPolicy);
    if (callAllowedUnderControlPolicy(policy, subject)) {
      kept.push(call);
    } else {
      const factoryName = options.resolveFactoryName(call);
      warnings.push(
        buildSubjectSuppressionWarning(subject, policy, factoryName, formatSubjectLabel),
      );
    }
  }

  return Object.freeze({
    kept: Object.freeze(kept),
    warnings: Object.freeze(warnings),
  });
}

/**
 * Partition a list of schema-issue-shaped inputs by the effective control
 * policy of each issue's subject *before* the planner is invoked.
 *
 * `plannable` is the list of issues whose subject's effective policy permits
 * the planner to act on them (`managed`, or `tolerated` for whole-object
 * creation issues only). Issues for `external`/`observed` subjects, and
 * non-creation issues for `tolerated` subjects, are dropped from the planner's
 * input entirely — they never enter introspection-driven planning, never feed
 * the diff engine, and never produce DDL calls that would have to be
 * post-filtered. This sidesteps a class of failure where the diff engine
 * cannot reason about the live shape of a subject the user marked as
 * out-of-scope (`external`).
 *
 * `warnings` is one {@link SqlPlannerConflict} per suppressed subject (not per
 * suppressed issue). `factoryName` is inferred from the subject's issue mix:
 * if any of the subject's issues is whole-object creation, the warning takes
 * the corresponding creation factoryName (e.g. `createTable`,
 * `createEnumType`, `createSchema`); otherwise it falls back to
 * `defaultModificationFactoryName(subject)` — a synthetic label that names
 * the *kind* of mutation that would have run, since no concrete DDL call was
 * generated.
 *
 * Unresolved-subject issues (`resolveControlPolicySubject` returns
 * `undefined`) emit one warning each; they cannot be deduplicated because
 * they carry no subject coordinate.
 */
export function partitionIssuesByControlPolicy<TIssue>(options: {
  readonly issues: readonly TIssue[];
  readonly contract: Contract<SqlStorage>;
  /**
   * Resolve the subject targeted by this issue (or `undefined` to fail-closed:
   * any policy stricter than `managed` drops the issue).
   */
  readonly resolveControlPolicySubject: (issue: TIssue) => ControlPolicySubject | undefined;
  /**
   * Resolve a creation factoryName for this issue if it represents the
   * absence of the whole top-level object (e.g. `'createTable'` for a
   * missing-table issue). When the issue describes a modification to an
   * existing object, return `undefined`. Both decisions feed off this signal:
   *
   * 1. Under `tolerated`, only issues whose `resolveCreationFactoryName`
   *    returns a value flow into the planner (create-if-absent).
   * 2. Subjects that have at least one creation-flavoured issue use the
   *    resolved creation factoryName for their suppression warning;
   *    otherwise they fall back to `defaultModificationFactoryName`.
   */
  readonly resolveCreationFactoryName: (issue: TIssue) => string | undefined;
  /**
   * Default modification factoryName for a suppressed subject whose issues
   * are all non-creation (the subject exists but has a different shape).
   * Defaults to `'alterTable'` / `'alterType'` / `'alterSchema'` based on the
   * subject's populated coordinates.
   */
  readonly defaultModificationFactoryName?: (subject: ControlPolicySubject) => string;
  readonly formatSubjectLabel?: (
    factoryName: string,
    subject: ControlPolicySubject | undefined,
  ) => string;
}): {
  readonly plannable: readonly TIssue[];
  readonly warnings: readonly SqlPlannerConflict[];
} {
  const defaultControlPolicy = options.contract.defaultControlPolicy;
  const formatSubjectLabel = options.formatSubjectLabel ?? defaultSubjectLabel;
  const inferModificationFactoryName =
    options.defaultModificationFactoryName ?? defaultModificationFactoryNameForSubject;

  const plannable: TIssue[] = [];
  // Resolved-subject suppressions are deduplicated by subject key so we emit
  // one warning per suppressed subject, not one per suppressed issue.
  // `creationFactoryName` upgrades from `undefined` to a concrete creation
  // name the first time we see a creation-flavoured issue for the subject.
  const suppressedSubjects = new Map<
    string,
    {
      readonly subject: ControlPolicySubject;
      readonly policy: ControlPolicy;
      creationFactoryName?: string;
    }
  >();
  const unresolvedSuppressions: SqlPlannerConflict[] = [];

  for (const issue of options.issues) {
    const subject = options.resolveControlPolicySubject(issue);
    const policy = controlPolicyForCall(subject, defaultControlPolicy);
    const creationFactoryName = options.resolveCreationFactoryName(issue);

    if (policy === 'managed') {
      plannable.push(issue);
      continue;
    }
    if (
      policy === 'tolerated' &&
      subject !== undefined &&
      creationFactoryName !== undefined &&
      subject.createsNewObject
    ) {
      plannable.push(issue);
      continue;
    }

    if (subject === undefined) {
      const factoryName = creationFactoryName ?? 'unknown';
      unresolvedSuppressions.push(
        buildSubjectSuppressionWarning(undefined, policy, factoryName, formatSubjectLabel),
      );
      continue;
    }

    const key = subjectKey(subject);
    const existing = suppressedSubjects.get(key);
    if (existing) {
      if (existing.creationFactoryName === undefined && creationFactoryName !== undefined) {
        existing.creationFactoryName = creationFactoryName;
      }
    } else {
      suppressedSubjects.set(key, {
        subject,
        policy,
        ...ifDefined('creationFactoryName', creationFactoryName),
      });
    }
  }

  const warnings: SqlPlannerConflict[] = [...unresolvedSuppressions];
  for (const entry of suppressedSubjects.values()) {
    const factoryName = entry.creationFactoryName ?? inferModificationFactoryName(entry.subject);
    warnings.push(
      buildSubjectSuppressionWarning(entry.subject, entry.policy, factoryName, formatSubjectLabel),
    );
  }

  return Object.freeze({
    plannable: Object.freeze(plannable),
    warnings: Object.freeze(warnings),
  });
}

function subjectKey(subject: ControlPolicySubject): string {
  return `${subject.namespaceId}\u0000${subject.table ?? ''}\u0000${subject.typeName ?? ''}`;
}
