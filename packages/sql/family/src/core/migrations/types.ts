type AnyRecord = Readonly<Record<string, unknown>>;

export type MigrationOperationClass = 'additive' | 'widening' | 'destructive';

export type MigrationPolicyMode = 'init' | 'update';

export interface MigrationPolicy {
  readonly mode: MigrationPolicyMode;
  readonly allowedOperationClasses: readonly MigrationOperationClass[];
}

export interface MigrationPlanOperationStep {
  readonly description: string;
  readonly sql: string;
  readonly meta?: AnyRecord;
}

export interface MigrationPlanOperationTarget<TTargetDetails> {
  readonly id: string;
  readonly details?: TTargetDetails;
}

export interface MigrationPlanOperation<TTargetDetails = Record<string, never>> {
  readonly id: string;
  readonly label: string;
  readonly summary?: string;
  readonly operationClass: MigrationOperationClass;
  readonly target: MigrationPlanOperationTarget<TTargetDetails>;
  readonly precheck: readonly MigrationPlanOperationStep[];
  readonly execute: readonly MigrationPlanOperationStep[];
  readonly postcheck: readonly MigrationPlanOperationStep[];
  readonly meta?: AnyRecord;
}

export interface MigrationPlanContractInfo {
  readonly coreHash: string;
  readonly profileHash?: string;
}

export interface MigrationPlan<TTargetDetails = Record<string, never>> {
  readonly targetId: string;
  readonly policy: MigrationPolicy;
  readonly contract: MigrationPlanContractInfo;
  readonly operations: readonly MigrationPlanOperation<TTargetDetails>[];
  readonly meta?: AnyRecord;
}

export type PlannerConflictKind =
  | 'typeMismatch'
  | 'nullabilityConflict'
  | 'indexIncompatible'
  | 'foreignKeyConflict'
  | 'missingButNonAdditive'
  | 'extensionMissing'
  | 'unsupportedOperation';

export interface PlannerConflictLocation {
  readonly table?: string;
  readonly column?: string;
  readonly index?: string;
  readonly constraint?: string;
  readonly extension?: string;
}

export interface PlannerConflict {
  readonly kind: PlannerConflictKind;
  readonly summary: string;
  readonly why?: string;
  readonly location?: PlannerConflictLocation;
  readonly meta?: AnyRecord;
}

export interface PlannerSuccessResult<TTargetDetails> {
  readonly kind: 'success';
  readonly plan: MigrationPlan<TTargetDetails>;
}

export interface PlannerFailureResult {
  readonly kind: 'failure';
  readonly conflicts: readonly PlannerConflict[];
}

export type PlannerResult<TTargetDetails = Record<string, never>> =
  | PlannerSuccessResult<TTargetDetails>
  | PlannerFailureResult;

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

function freezeOperation<TTargetDetails>(
  operation: MigrationPlanOperation<TTargetDetails>,
): MigrationPlanOperation<TTargetDetails> {
  return Object.freeze({
    id: operation.id,
    label: operation.label,
    ...(operation.summary ? { summary: operation.summary } : {}),
    operationClass: operation.operationClass,
    target: Object.freeze({
      id: operation.target.id,
      ...(operation.target.details ? { details: operation.target.details } : {}),
    }),
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
    mode: policy.mode,
    allowedOperationClasses: Object.freeze([...policy.allowedOperationClasses]),
  });
}

export interface CreateMigrationPlanOptions<TTargetDetails> {
  readonly targetId: string;
  readonly policy: MigrationPolicy;
  readonly contract: MigrationPlanContractInfo;
  readonly operations: readonly MigrationPlanOperation<TTargetDetails>[];
  readonly meta?: AnyRecord;
}

export function createMigrationPlan<TTargetDetails = Record<string, never>>(
  options: CreateMigrationPlanOptions<TTargetDetails>,
): MigrationPlan<TTargetDetails> {
  return Object.freeze({
    targetId: options.targetId,
    policy: normalizePolicy(options.policy),
    contract: Object.freeze({ ...options.contract }),
    operations: freezeOperations(options.operations),
    ...(options.meta ? { meta: cloneRecord(options.meta) } : {}),
  });
}

export const INIT_ADDITIVE_POLICY: MigrationPolicy = Object.freeze({
  mode: 'init' as const,
  allowedOperationClasses: Object.freeze(['additive'] as const),
});

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
