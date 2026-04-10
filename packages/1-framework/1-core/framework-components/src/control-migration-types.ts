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

import type { Contract } from '@prisma-next/contract/types';
import type { Result } from '@prisma-next/utils/result';
import type { ControlDriverInstance, ControlFamilyInstance } from './control-instances';
import type { TargetBoundComponentDescriptor } from './framework-components';

// ============================================================================
// Operation Classes and Policy
// ============================================================================

/**
 * Migration operation classes define the safety level of an operation.
 * - 'additive': Adds new structures without modifying existing ones (safe)
 * - 'widening': Relaxes constraints or expands types (generally safe)
 * - 'destructive': Removes or alters existing structures (potentially unsafe)
 * - 'data': Data transformation operation (e.g., backfill, type conversion)
 */
export type MigrationOperationClass = 'additive' | 'widening' | 'destructive' | 'data';

// ============================================================================
// Data Transform Operation
// ============================================================================

/**
 * A lowered query statement as stored in ops.json.
 * Contains the SQL string and parameter values — ready for execution.
 * Lowering from query builder AST to SQL happens at verify time.
 */
export interface SerializedQueryPlan {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * A data transform operation within a migration edge.
 *
 * Data transforms are authored in TypeScript using the query builder,
 * serialized to JSON ASTs at verification time, and rendered to SQL
 * by the target adapter at apply time.
 *
 * The `name` serves as the invariant identity — it's recorded in the
 * ledger and used for invariant-aware routing via environment refs.
 *
 * In draft state (before verification), `check` and `run` are null.
 * After verification, they contain the serialized query ASTs.
 */
export interface DataTransformOperation extends MigrationPlanOperation {
  readonly operationClass: 'data';
  /**
   * The invariant name for this data transform.
   * Recorded in the ledger on successful edge completion.
   * Used by environment refs to declare required invariants.
   */
  readonly name: string;
  /**
   * Path to the TypeScript source file that produced this operation.
   * Not part of edgeId computation — for traceability only.
   */
  readonly source: string;
  /**
   * Serialized check query plan, or a boolean literal.
   * - SerializedQueryPlan: describes violations; empty result = already applied.
   * - false: always run (no check).
   * - true: always skip.
   * - null: not yet serialized (draft state).
   */
  readonly check: SerializedQueryPlan | boolean | null;
  /**
   * Serialized run query plans.
   * - Array of serialized query plans to execute sequentially.
   * - null: not yet serialized (draft state).
   */
  readonly run: readonly SerializedQueryPlan[] | null;
}

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
 * Minimal shape for operation descriptors at the framework level.
 * Targets produce richer types; this captures just enough for the
 * framework to scaffold migration.ts files and pass descriptors through.
 */
export interface OperationDescriptor {
  readonly kind: string;
  readonly [key: string]: unknown;
}

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

// ============================================================================
// Plan Types (Display-Oriented)
// ============================================================================

/**
 * A migration plan for display purposes.
 * Contains only the fields needed for CLI output (summary, JSON envelope).
 */
export interface MigrationPlan {
  /** The target ID this plan is for (e.g., 'postgres'). */
  readonly targetId: string;
  /**
   * Origin contract identity that the plan expects the database to currently be at.
   * If omitted or null, the runner skips origin validation entirely.
   */
  readonly origin?: {
    readonly storageHash: string;
    readonly profileHash?: string;
  } | null;
  /** Destination contract identity that the plan intends to reach. */
  readonly destination: {
    readonly storageHash: string;
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
  /** Optional metadata for debugging and UX (e.g., schema issues, SQL state). */
  readonly meta?: Record<string, unknown>;
}

/**
 * Result type for migration runner execution.
 */
export type MigrationRunnerResult = Result<MigrationRunnerSuccessValue, MigrationRunnerFailure>;

// ============================================================================
// Execution Checks Configuration
// ============================================================================

/**
 * Execution-time checks configuration for migration runners.
 * All checks default to `true` (enabled) when omitted.
 */
export interface MigrationRunnerExecutionChecks {
  /**
   * Whether to run prechecks before executing operations.
   * Defaults to `true` (prechecks are run).
   */
  readonly prechecks?: boolean;
  /**
   * Whether to run postchecks after executing operations.
   * Defaults to `true` (postchecks are run).
   */
  readonly postchecks?: boolean;
  /**
   * Whether to run idempotency probe (check if postcheck is already satisfied before execution).
   * Defaults to `true` (idempotency probe is run).
   */
  readonly idempotencyChecks?: boolean;
}

// ============================================================================
// Planner and Runner Interfaces
// ============================================================================

/**
 * Migration planner interface for planning schema changes.
 * This is the minimal interface that CLI commands use.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export interface MigrationPlanner<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  plan(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    /**
     * Active framework components participating in this composition.
     * Families/targets can interpret this list to derive family-specific metadata.
     * All components must have matching familyId and targetId.
     */
    readonly frameworkComponents: ReadonlyArray<
      TargetBoundComponentDescriptor<TFamilyId, TTargetId>
    >;
  }): MigrationPlannerResult;
}

/**
 * Migration runner interface for executing migration plans.
 * This is the minimal interface that CLI commands use.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export interface MigrationRunner<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  execute(options: {
    readonly plan: MigrationPlan;
    readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
    readonly destinationContract: unknown;
    readonly policy: MigrationOperationPolicy;
    readonly callbacks?: {
      onOperationStart?(op: MigrationPlanOperation): void;
      onOperationComplete?(op: MigrationPlanOperation): void;
    };
    /**
     * Execution-time checks configuration.
     * All checks default to `true` (enabled) when omitted.
     */
    readonly executionChecks?: MigrationRunnerExecutionChecks;
    /**
     * Active framework components participating in this composition.
     * Families/targets can interpret this list to derive family-specific metadata.
     * All components must have matching familyId and targetId.
     */
    readonly frameworkComponents: ReadonlyArray<
      TargetBoundComponentDescriptor<TFamilyId, TTargetId>
    >;
  }): Promise<MigrationRunnerResult>;
}

// ============================================================================
// Target Migrations Capability
// ============================================================================

/**
 * Optional capability interface for targets that support migrations.
 * Targets that implement migrations expose this via their descriptor.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 * @template TFamilyInstance - The family instance type (e.g., SqlControlFamilyInstance)
 */
export interface TargetMigrationsCapability<
  TFamilyId extends string = string,
  TTargetId extends string = string,
  TFamilyInstance extends ControlFamilyInstance<TFamilyId, unknown> = ControlFamilyInstance<
    TFamilyId,
    unknown
  >,
> {
  createPlanner(family: TFamilyInstance): MigrationPlanner<TFamilyId, TTargetId>;
  createRunner(family: TFamilyInstance): MigrationRunner<TFamilyId, TTargetId>;
  /**
   * Synthesizes a family-specific schema IR from a contract for offline planning.
   * The returned schema can be passed to `planner.plan({ schema })` as the "from" state.
   *
   * @param contract - The contract to convert, or null for a new project (empty schema).
   * @param frameworkComponents - Active framework components, used to derive database
   *   dependencies (e.g. extensions) that should be reflected in the schema IR.
   * @returns Family-specific schema IR (e.g., `SqlSchemaIR` for SQL targets).
   */
  contractToSchema(
    contract: Contract | null,
    frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>,
  ): unknown;

  /**
   * Plans a migration using the descriptor-based planner.
   * Returns operation descriptors and whether data migration is needed.
   * The caller decides whether to resolve immediately or scaffold migration.ts.
   */
  planWithDescriptors?(context: {
    readonly fromContract: Contract | null;
    readonly toContract: Contract;
    readonly frameworkComponents?: ReadonlyArray<
      TargetBoundComponentDescriptor<TFamilyId, TTargetId>
    >;
  }):
    | {
        readonly ok: true;
        readonly descriptors: readonly OperationDescriptor[];
        readonly needsDataMigration: boolean;
      }
    | {
        readonly ok: false;
        readonly conflicts: readonly MigrationPlannerConflict[];
      };

  /**
   * Resolves operation descriptors into target-specific migration plan operations
   * with SQL/DDL, prechecks, and postchecks. Called by `migration verify` to
   * serialize migration.ts into ops.json.
   */
  resolveDescriptors?(
    descriptors: readonly OperationDescriptor[],
    context: {
      readonly fromContract: Contract | null;
      readonly toContract: Contract;
      readonly schemaName?: string;
      readonly frameworkComponents?: ReadonlyArray<
        TargetBoundComponentDescriptor<TFamilyId, TTargetId>
      >;
    },
  ): readonly MigrationPlanOperation[];
}
