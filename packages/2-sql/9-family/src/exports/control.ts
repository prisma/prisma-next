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
export type { SqlControlFamilyInstance } from '../core/control-instance';
export type {
  ContractToSchemaIROptions,
  DefaultRenderer,
  EnumStorageKeyResolver,
  NativeTypeExpander,
} from '../core/migrations/contract-to-schema-ir';
// Contract → SchemaIR conversion for offline migration planning
export {
  contractToSchemaIR,
  detectDestructiveChanges,
} from '../core/migrations/contract-to-schema-ir';
export type { ControlPolicySubject } from '../core/migrations/control-policy';
export { filterCallsByControlPolicy } from '../core/migrations/control-policy';
export type { PlanFieldEventOperationsOptions } from '../core/migrations/field-event-planner';
export { planFieldEventOperations } from '../core/migrations/field-event-planner';
export {
  createMigrationPlan,
  plannerFailure,
  plannerSuccess,
  runnerFailure,
  runnerSuccess,
} from '../core/migrations/plan-helpers';
export { INIT_ADDITIVE_POLICY } from '../core/migrations/policies';
export type {
  CodecControlHooks,
  CreateSqlMigrationPlanOptions,
  ExpandNativeTypeInput,
  FieldEvent,
  FieldEventContext,
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
export {
  temporalAuthoringPresets,
  timestampNowControlDescriptor,
} from '../core/timestamp-now-generator';

export default new SqlFamilyDescriptor();
