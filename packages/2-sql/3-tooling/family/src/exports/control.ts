import { SqlFamilyDescriptor } from '../core/descriptor';

export type { SchemaVerifyOptions, SqlControlFamilyInstance } from '../core/instance';
export {
  createMigrationPlan,
  plannerFailure,
  plannerSuccess,
  runnerFailure,
  runnerSuccess,
} from '../core/migrations/plan-helpers';
export { INIT_ADDITIVE_POLICY } from '../core/migrations/policies';
export type {
  CreateMigrationPlanOptions,
  MigrationOperationClass,
  MigrationPlan,
  MigrationPlanContractInfo,
  MigrationPlanner,
  MigrationPlannerPlanOptions,
  MigrationPlanOperation,
  MigrationPlanOperationStep,
  MigrationPlanOperationTarget,
  MigrationPolicy,
  MigrationRunner,
  MigrationRunnerErrorCode,
  MigrationRunnerExecuteCallbacks,
  MigrationRunnerExecuteOptions,
  MigrationRunnerFailure,
  MigrationRunnerResult,
  MigrationRunnerSuccessValue,
  PlannerConflict,
  PlannerConflictKind,
  PlannerConflictLocation,
  PlannerFailureResult,
  PlannerResult,
  PlannerSuccessResult,
  SqlControlTargetDescriptor,
} from '../core/migrations/types';

/**
 * SQL family descriptor for control plane (CLI/config).
 * Provides the SQL family hook and conversion helpers.
 */
export default new SqlFamilyDescriptor();
