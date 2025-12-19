export type AnyRecord = Readonly<Record<string, unknown>>;

export type MigrationOperationClass = 'additive' | 'widening' | 'destructive';

export interface MigrationPolicy {
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

export interface CreateMigrationPlanOptions<TTargetDetails> {
  readonly targetId: string;
  readonly policy: MigrationPolicy;
  readonly contract: MigrationPlanContractInfo;
  readonly operations: readonly MigrationPlanOperation<TTargetDetails>[];
  readonly meta?: AnyRecord;
}
