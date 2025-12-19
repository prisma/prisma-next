import { SqlFamilyDescriptor } from '../core/descriptor';

export type { SqlControlFamilyInstance } from '../core/instance';
export {
  createMigrationPlan,
  plannerFailure,
  plannerSuccess,
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
  MigrationRunnerExecuteCallbacks,
  MigrationRunnerExecuteOptions,
  MigrationRunnerResult,
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
