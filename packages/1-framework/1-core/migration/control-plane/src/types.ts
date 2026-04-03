import type {
  ControlFamilyInstance,
  ControlTargetDescriptor,
} from '@prisma-next/framework-components/control';
import type { TargetMigrationsCapability } from './migrations';
import type { CoreSchemaView } from './schema-view';

// Re-export all moved types from framework-components
export type {
  ControlAdapterDescriptor,
  ControlAdapterInstance,
  ControlDriverDescriptor,
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlExtensionInstance,
  ControlFamilyDescriptor,
  ControlFamilyInstance,
  ControlPlaneStack,
  ControlStack,
  ControlTargetDescriptor,
  ControlTargetInstance,
  EmitContractResult,
  IntrospectSchemaResult,
  OperationContext,
  SchemaIssue,
  SchemaVerificationNode,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';

// Re-export migration types (canonical, defined in ./migrations)
export type {
  MigrationOperationClass,
  MigrationOperationPolicy,
  MigrationPlan,
  MigrationPlanner,
  MigrationPlannerConflict,
  MigrationPlannerFailureResult,
  MigrationPlannerResult,
  MigrationPlannerSuccessResult,
  MigrationPlanOperation,
  MigrationRunner,
  MigrationRunnerExecutionChecks,
  MigrationRunnerFailure,
  MigrationRunnerResult,
  MigrationRunnerSuccessValue,
  TargetMigrationsCapability,
} from './migrations';

// ============================================================================
// Capability interfaces (dependency inversion)
// ============================================================================

/**
 * Extension of ControlTargetDescriptor for targets that support migrations.
 * Use `hasMigrations()` to narrow a ControlTargetDescriptor to this type.
 */
export interface MigratableTargetDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TFamilyInstance extends ControlFamilyInstance<TFamilyId> = ControlFamilyInstance<TFamilyId>,
> extends ControlTargetDescriptor<TFamilyId, TTargetId> {
  readonly migrations: TargetMigrationsCapability<TFamilyId, TTargetId, TFamilyInstance>;
}

export function hasMigrations<TFamilyId extends string, TTargetId extends string>(
  target: ControlTargetDescriptor<TFamilyId, TTargetId>,
): target is MigratableTargetDescriptor<TFamilyId, TTargetId> {
  return 'migrations' in target && !!(target as Record<string, unknown>)['migrations'];
}

/**
 * Capability interface for family instances that can project schema IR into a CoreSchemaView.
 * Use `hasSchemaView()` to narrow a ControlFamilyInstance to this type.
 */
export interface SchemaViewCapable<TSchemaIR = unknown> {
  toSchemaView(schema: TSchemaIR): CoreSchemaView;
}

export function hasSchemaView<TFamilyId extends string>(
  instance: ControlFamilyInstance<TFamilyId>,
): instance is ControlFamilyInstance<TFamilyId> & SchemaViewCapable {
  return (
    'toSchemaView' in instance &&
    typeof (instance as Record<string, unknown>)['toSchemaView'] === 'function'
  );
}
