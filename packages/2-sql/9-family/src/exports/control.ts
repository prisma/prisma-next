import { SqlFamilyDescriptor } from '../core/control-descriptor';

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
} from '@prisma-next/framework-components/control';
export { assembleAuthoringContributions } from '@prisma-next/framework-components/control';
export { extractCodecControlHooks } from '../core/assembly';
export type { SchemaVerifyOptions, SqlControlFamilyInstance } from '../core/control-instance';
export type {
  ContractToSchemaIROptions,
  DefaultRenderer,
  NativeTypeExpander,
} from '../core/migrations/contract-to-schema-ir';
// Contract → SchemaIR conversion for offline migration planning
export {
  contractToSchemaIR,
  detectDestructiveChanges,
} from '../core/migrations/contract-to-schema-ir';
export {
  createMigrationPlan,
  plannerFailure,
  plannerSuccess,
  runnerFailure,
  runnerSuccess,
} from '../core/migrations/plan-helpers';
export { INIT_ADDITIVE_POLICY } from '../core/migrations/policies';
export type {
  AnySqlMigrationOperation,
  CodecControlHooks,
  ComponentDatabaseDependencies,
  ComponentDatabaseDependency,
  CreateSqlMigrationPlanOptions,
  ExpandNativeTypeInput,
  ResolveIdentityValueInput,
  SqlControlAdapterDescriptor,
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
  SqlPlanTargetDetails,
  StorageTypePlanResult,
} from '../core/migrations/types';
export { collectInitDependencies, isDatabaseDependencyProvider } from '../core/migrations/types';

export default new SqlFamilyDescriptor();
