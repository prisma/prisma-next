import { SqlFamilyDescriptor } from '../core/descriptor.ts';

// Re-export core types from canonical source
export type {
  MigrationOperationClass,
  MigrationOperationPolicy,
  MigrationPlan,
  MigrationPlanner,
  MigrationPlannerConflict,
  MigrationPlannerResult,
  MigrationPlanOperation,
  TargetMigrationsCapability,
} from '@prisma-next/core-control-plane/types';
export type { SchemaVerifyOptions, SqlControlFamilyInstance } from '../core/instance.ts';
export {
  createMigrationPlan,
  plannerFailure,
  plannerSuccess,
  runnerFailure,
  runnerSuccess,
} from '../core/migrations/plan-helpers.ts';
export { INIT_ADDITIVE_POLICY } from '../core/migrations/policies.ts';
// SQL-specific types
export type {
  ComponentDatabaseDependencies,
  ComponentDatabaseDependency,
  CreateSqlMigrationPlanOptions,
  SqlControlExtensionDescriptor,
  SqlControlTargetDescriptor,
  SqlMigrationPlan,
  SqlMigrationPlanContractInfo,
  SqlMigrationPlanner,
  SqlMigrationPlannerPlanOptions,
  SqlMigrationPlanOperation,
  SqlMigrationPlanOperationStep,
  SqlMigrationPlanOperationTarget,
  SqlMigrationRunner,
  SqlMigrationRunnerErrorCode,
  SqlMigrationRunnerExecuteCallbacks,
  SqlMigrationRunnerExecuteOptions,
  SqlMigrationRunnerFailure,
  SqlMigrationRunnerResult,
  SqlMigrationRunnerSuccessValue,
  SqlPlannerConflict,
  SqlPlannerConflictKind,
  SqlPlannerConflictLocation,
  SqlPlannerFailureResult,
  SqlPlannerResult,
  SqlPlannerSuccessResult,
} from '../core/migrations/types.ts';

/**
 * SQL family descriptor for control plane (CLI/config).
 * Provides the SQL family hook and conversion helpers.
 */
export default new SqlFamilyDescriptor();
