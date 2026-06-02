import {
  type Contract,
  type ControlPolicy,
  effectiveControlPolicy,
} from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';

/**
 * Control-relevant facts about a single planner call's target object, as
 * resolved from the target's own IR. `undefined` (no subject) means the
 * call's target could not be positively established — a fail-closed signal:
 * any policy stricter than `managed` drops such a call rather than emitting
 * it.
 */
export interface ResolvedControlSubject {
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
function controlPolicyForCall(
  subject: ResolvedControlSubject | undefined,
  defaultControl: ControlPolicy | undefined,
): ControlPolicy {
  if (defaultControl === 'external') {
    return 'external';
  }
  return effectiveControlPolicy(subject?.explicitNodeControlPolicy, defaultControl);
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
  subject: ResolvedControlSubject | undefined,
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

export function filterCallsByControlPolicy<TCall>(options: {
  readonly calls: readonly TCall[];
  readonly contract: Contract<SqlStorage>;
  readonly resolveSubject: (call: TCall) => ResolvedControlSubject | undefined;
}): readonly TCall[] {
  const defaultControl = options.contract.defaultControl;
  const kept: TCall[] = [];

  for (const call of options.calls) {
    const subject = options.resolveSubject(call);
    const policy = controlPolicyForCall(subject, defaultControl);
    if (callAllowedUnderControlPolicy(policy, subject)) {
      kept.push(call);
    }
  }

  return Object.freeze(kept);
}
