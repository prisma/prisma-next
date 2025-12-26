import { SqlFamilyDescriptor } from '../core/descriptor';

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
  MigrationPlanOperation,
  MigrationPlanOperationStep,
  MigrationPlanOperationTarget,
  MigrationPolicy,
  PlannerConflict,
  PlannerConflictKind,
  PlannerConflictLocation,
  PlannerFailureResult,
  PlannerResult,
  PlannerSuccessResult,
} from '../core/migrations/types';

/**
 * SQL family descriptor for control plane (CLI/config).
 * Provides the SQL family hook and conversion helpers.
 */
export default new SqlFamilyDescriptor();
