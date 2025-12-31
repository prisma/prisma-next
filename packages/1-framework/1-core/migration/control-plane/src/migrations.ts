/**
 * Core migration types for the framework control plane.
 *
 * These are family-agnostic, display-oriented types that provide a stable
 * vocabulary for CLI commands to work with migration planners and runners
 * without importing family-specific types.
 *
 * Family-specific types (e.g., SqlMigrationPlan) extend these base types
 * with additional fields for execution (precheck SQL, execute SQL, etc.).
 */
import type { Result } from '@prisma-next/utils/result';
import type { ControlDriverInstance, ControlFamilyInstance } from './types';

// ============================================================================
// Operation Classes and Policy
// ============================================================================

/**
 * Migration operation classes define the safety level of an operation.
 * - 'additive': Adds new structures without modifying existing ones (safe)
 * - 'widening': Relaxes constraints or expands types (generally safe)
 * - 'destructive': Removes or alters existing structures (potentially unsafe)
 */
export type MigrationOperationClass = 'additive' | 'widening' | 'destructive';

/**
 * Policy defining which operation classes are allowed during a migration.
 */
export interface MigrationOperationPolicy {
  readonly allowedOperationClasses: readonly MigrationOperationClass[];
}

// ============================================================================
// Plan Types (Display-Oriented)
// ============================================================================

/**
 * A single migration operation for display purposes.
 * Contains only the fields needed for CLI output (tree view, JSON envelope).
 */
export interface MigrationPlanOperation {
  /** Unique identifier for this operation (e.g., "table.users.create"). */
  readonly id: string;
  /** Human-readable label for display in UI/CLI (e.g., "Create table users"). */
  readonly label: string;
  /** The class of operation (additive, widening, destructive). */
  readonly operationClass: MigrationOperationClass;
}

/**
 * A migration plan for display purposes.
 * Contains only the fields needed for CLI output (summary, JSON envelope).
 */
export interface MigrationPlan {
  /** The target ID this plan is for (e.g., 'postgres'). */
  readonly targetId: string;
  /** Destination contract identity that the plan intends to reach. */
  readonly destination: {
    readonly coreHash: string;
    readonly profileHash?: string;
  };
  /** Ordered list of operations to execute. */
  readonly operations: readonly MigrationPlanOperation[];
}

// ============================================================================
// Planner Result Types
// ============================================================================

/**
 * A conflict detected during migration planning.
 */
export interface MigrationPlannerConflict {
  /** Kind of conflict (e.g., 'typeMismatch', 'nullabilityConflict'). */
  readonly kind: string;
  /** Human-readable summary of the conflict. */
  readonly summary: string;
  /** Optional explanation of why this conflict occurred. */
  readonly why?: string;
}

/**
 * Successful planner result with the migration plan.
 */
export interface MigrationPlannerSuccessResult {
  readonly kind: 'success';
  readonly plan: MigrationPlan;
}

/**
 * Failed planner result with the list of conflicts.
 */
export interface MigrationPlannerFailureResult {
  readonly kind: 'failure';
  readonly conflicts: readonly MigrationPlannerConflict[];
}

/**
 * Union type for planner results.
 */
export type MigrationPlannerResult = MigrationPlannerSuccessResult | MigrationPlannerFailureResult;

// ============================================================================
// Runner Result Types
// ============================================================================

/**
 * Success value for migration runner execution.
 */
export interface MigrationRunnerSuccessValue {
  readonly operationsPlanned: number;
  readonly operationsExecuted: number;
}

/**
 * Failure details for migration runner execution.
 */
export interface MigrationRunnerFailure {
  /** Error code for the failure. */
  readonly code: string;
  /** Human-readable summary of the failure. */
  readonly summary: string;
  /** Optional explanation of why the failure occurred. */
  readonly why?: string;
}

/**
 * Result type for migration runner execution.
 */
export type MigrationRunnerResult = Result<MigrationRunnerSuccessValue, MigrationRunnerFailure>;

// ============================================================================
// Planner and Runner Interfaces
// ============================================================================

/**
 * Migration planner interface for planning schema changes.
 * This is the minimal interface that CLI commands use.
 */
export interface MigrationPlanner {
  plan(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
  }): MigrationPlannerResult;
}

/**
 * Migration runner interface for executing migration plans.
 * This is the minimal interface that CLI commands use.
 */
export interface MigrationRunner {
  execute(options: {
    readonly plan: MigrationPlan;
    readonly driver: ControlDriverInstance<string, string>;
    readonly destinationContract: unknown;
    readonly policy: MigrationOperationPolicy;
    readonly callbacks?: {
      onOperationStart?(op: MigrationPlanOperation): void;
      onOperationComplete?(op: MigrationPlanOperation): void;
    };
  }): Promise<MigrationRunnerResult>;
}

// ============================================================================
// Target Migrations Capability
// ============================================================================

/**
 * Optional capability interface for targets that support migrations.
 * Targets that implement migrations expose this via their descriptor.
 *
 * @template TFamilyInstance - The family instance type (e.g., SqlControlFamilyInstance)
 */
export interface TargetMigrationsCapability<
  TFamilyInstance extends ControlFamilyInstance<string> = ControlFamilyInstance<string>,
> {
  createPlanner(family: TFamilyInstance): MigrationPlanner;
  createRunner(family: TFamilyInstance): MigrationRunner;
}
