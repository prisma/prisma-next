import { SqlFamilyDescriptor } from '../core/descriptor';

export type {
  CreateMigrationPlanOptions,
  MigrationOperationClass,
  MigrationPlan,
  MigrationPlanContractInfo,
  MigrationPlanOperation,
  MigrationPlanOperationStep,
  MigrationPlanOperationTarget,
  MigrationPolicy,
  MigrationPolicyMode,
  PlannerConflict,
  PlannerConflictKind,
  PlannerConflictLocation,
  PlannerFailureResult,
  PlannerResult,
  PlannerSuccessResult,
} from '../core/migrations/types';
export {
  createMigrationPlan,
  INIT_ADDITIVE_POLICY,
  plannerFailure,
  plannerSuccess,
} from '../core/migrations/types';

/**
 * SQL family descriptor for control plane (CLI/config).
 * Provides the SQL family hook and conversion helpers.
 */
export default new SqlFamilyDescriptor();
