import type {
  AnyRecord,
  CreateMigrationPlanOptions,
  MigrationPlan,
  MigrationPlanOperation,
  MigrationPlanOperationStep,
  MigrationPlanOperationTarget,
  MigrationPolicy,
  PlannerConflict,
  PlannerFailureResult,
  PlannerSuccessResult,
} from './types';

const readOnlyEmptyObject: Record<string, never> = Object.freeze({});

function cloneRecord<T extends AnyRecord>(value: T): T {
  if (value === readOnlyEmptyObject) {
    return value;
  }
  return Object.freeze({ ...value }) as T;
}

function freezeSteps(
  steps: readonly MigrationPlanOperationStep[],
): readonly MigrationPlanOperationStep[] {
  if (steps.length === 0) {
    return Object.freeze([]);
  }
  return Object.freeze(
    steps.map((step) =>
      Object.freeze({
        description: step.description,
        sql: step.sql,
        ...(step.meta ? { meta: cloneRecord(step.meta) } : {}),
      }),
    ),
  );
}

function freezeTargetDetails<TTargetDetails>(
  target: MigrationPlanOperationTarget<TTargetDetails>,
): MigrationPlanOperationTarget<TTargetDetails> {
  return Object.freeze({
    id: target.id,
    ...(target.details ? { details: target.details } : {}),
  });
}

function freezeOperation<TTargetDetails>(
  operation: MigrationPlanOperation<TTargetDetails>,
): MigrationPlanOperation<TTargetDetails> {
  return Object.freeze({
    id: operation.id,
    label: operation.label,
    ...(operation.summary ? { summary: operation.summary } : {}),
    operationClass: operation.operationClass,
    target: freezeTargetDetails(operation.target),
    precheck: freezeSteps(operation.precheck),
    execute: freezeSteps(operation.execute),
    postcheck: freezeSteps(operation.postcheck),
    ...(operation.meta ? { meta: cloneRecord(operation.meta) } : {}),
  });
}

function freezeOperations<TTargetDetails>(
  operations: readonly MigrationPlanOperation<TTargetDetails>[],
): readonly MigrationPlanOperation<TTargetDetails>[] {
  if (operations.length === 0) {
    return Object.freeze([]);
  }
  return Object.freeze(operations.map((operation) => freezeOperation(operation)));
}

function normalizePolicy(policy: MigrationPolicy): MigrationPolicy {
  return Object.freeze({
    allowedOperationClasses: Object.freeze([...policy.allowedOperationClasses]),
  });
}

export function createMigrationPlan<TTargetDetails = Record<string, never>>(
  options: CreateMigrationPlanOptions<TTargetDetails>,
): MigrationPlan<TTargetDetails> {
  return Object.freeze({
    targetId: options.targetId,
    policy: normalizePolicy(options.policy),
    ...(options.origin !== undefined
      ? { origin: options.origin ? Object.freeze({ ...options.origin }) : null }
      : {}),
    destination: Object.freeze({ ...options.destination }),
    operations: freezeOperations(options.operations),
    ...(options.meta ? { meta: cloneRecord(options.meta) } : {}),
  });
}

export function plannerSuccess<TTargetDetails>(
  plan: MigrationPlan<TTargetDetails>,
): PlannerSuccessResult<TTargetDetails> {
  return Object.freeze({
    kind: 'success',
    plan,
  });
}

export function plannerFailure(conflicts: readonly PlannerConflict[]): PlannerFailureResult {
  return Object.freeze({
    kind: 'failure' as const,
    conflicts: Object.freeze(
      conflicts.map((conflict) =>
        Object.freeze({
          kind: conflict.kind,
          summary: conflict.summary,
          ...(conflict.why ? { why: conflict.why } : {}),
          ...(conflict.location ? { location: Object.freeze({ ...conflict.location }) } : {}),
          ...(conflict.meta ? { meta: cloneRecord(conflict.meta) } : {}),
        }),
      ),
    ),
  });
}
