import type {
  ControlDriverInstance,
  ControlTargetDescriptor,
  OperationContext,
} from '@prisma-next/core-control-plane/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import type { SqlControlFamilyInstance } from '../instance';

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

export interface MigrationPlannerPlanOptions {
  readonly contract: SqlContract<SqlStorage>;
  readonly schema: SqlSchemaIR;
  readonly policy: MigrationPolicy;
  readonly schemaName?: string;
}

export interface MigrationPlanner<TTargetDetails = Record<string, never>> {
  plan(options: MigrationPlannerPlanOptions): PlannerResult<TTargetDetails>;
}

export interface MigrationRunnerExecuteCallbacks<TTargetDetails = Record<string, never>> {
  onOperationStart?(operation: MigrationPlanOperation<TTargetDetails>): void;
  onOperationComplete?(operation: MigrationPlanOperation<TTargetDetails>): void;
}

export interface MigrationRunnerExecuteOptions<TTargetDetails = Record<string, never>> {
  readonly plan: MigrationPlan<TTargetDetails>;
  readonly driver: ControlDriverInstance;
  readonly contract: SqlContract<SqlStorage>;
  readonly schemaName?: string;
  readonly strictVerification?: boolean;
  readonly callbacks?: MigrationRunnerExecuteCallbacks<TTargetDetails>;
  readonly context?: OperationContext;
}

export interface MigrationRunnerResult {
  readonly operationsPlanned: number;
  readonly operationsExecuted: number;
}

export interface MigrationRunner<TTargetDetails = Record<string, never>> {
  execute(options: MigrationRunnerExecuteOptions<TTargetDetails>): Promise<MigrationRunnerResult>;
}

export interface SqlControlTargetDescriptor<
  TTargetId extends string,
  TTargetDetails = Record<string, never>,
> extends ControlTargetDescriptor<'sql', TTargetId> {
  createPlanner(family: SqlControlFamilyInstance): MigrationPlanner<TTargetDetails>;
  createRunner(family: SqlControlFamilyInstance): MigrationRunner<TTargetDetails>;
}

export interface CreateMigrationPlanOptions<TTargetDetails> {
  readonly targetId: string;
  readonly policy: MigrationPolicy;
  readonly contract: MigrationPlanContractInfo;
  readonly operations: readonly MigrationPlanOperation<TTargetDetails>[];
  readonly meta?: AnyRecord;
}
