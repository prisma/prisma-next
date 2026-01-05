/**
 * SQL-specific migration types.
 *
 * These types extend the canonical migration types from the framework control plane
 * with SQL-specific fields for execution (precheck SQL, execute SQL, etc.).
 */

import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import type {
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlTargetDescriptor,
  ControlTargetInstance,
  MigrationOperationPolicy,
  MigrationPlan,
  MigrationPlannerConflict,
  MigrationPlannerFailureResult,
  MigrationPlannerSuccessResult,
  MigrationPlanOperation,
  MigrationRunnerExecutionChecks,
  MigrationRunnerFailure,
  MigrationRunnerSuccessValue,
  OperationContext,
  SchemaIssue,
} from '@prisma-next/core-control-plane/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import type { Result } from '@prisma-next/utils/result';
import type { SqlControlFamilyInstance } from '../instance';

export type AnyRecord = Readonly<Record<string, unknown>>;

// ============================================================================
// Component Database Dependencies
// ============================================================================

/**
 * A single database dependency declared by a framework component.
 * Uses SqlMigrationPlanOperation so we inherit the existing precheck/execute/postcheck contract.
 *
 * Database dependencies allow components (extensions, adapters) to declare what database-side
 * persistence structures they require (e.g., Postgres extensions, schemas, functions).
 * The planner emits these as migration operations, and the verifier uses the pure verification
 * hook to check satisfaction against the schema IR.
 */
export interface ComponentDatabaseDependency<TTargetDetails> {
  /** Stable identifier for the dependency (e.g. 'postgres.extension.vector') */
  readonly id: string;
  /** Human label for output (e.g. 'Enable vector extension') */
  readonly label: string;
  /**
   * Operations that install/ensure the dependency.
   * Use SqlMigrationPlanOperation so we inherit the existing precheck/execute/postcheck contract.
   */
  readonly install: readonly SqlMigrationPlanOperation<TTargetDetails>[];
  /**
   * Pure verification hook: checks whether this dependency is already installed
   * based on the in-memory schema IR (no DB I/O).
   *
   * This must return structured issues suitable for CLI and tree output, not just a boolean.
   */
  readonly verifyDatabaseDependencyInstalled: (schema: SqlSchemaIR) => readonly SchemaIssue[];
}

/**
 * Database dependencies declared by a framework component.
 */
export interface ComponentDatabaseDependencies<TTargetDetails> {
  /**
   * Dependencies required for db init.
   * Future: update dependencies can be added later (e.g. widening/destructive).
   */
  readonly init?: readonly ComponentDatabaseDependency<TTargetDetails>[];
}

/**
 * Minimal structural type implemented by any descriptor that can expose
 * component-owned database dependencies. Targets/adapters typically omit
 * the property, while extensions provide dependency metadata.
 */
export interface DatabaseDependencyProvider {
  readonly databaseDependencies?: ComponentDatabaseDependencies<unknown>;
}

// ============================================================================
// SQL Control Extension Descriptor
// ============================================================================

/**
 * SQL-specific extension descriptor with optional database dependencies.
 * Extends the core ControlExtensionDescriptor with SQL-specific metadata.
 *
 * Database dependencies are attached to the descriptor (not the instance) because
 * they are declarative metadata that planner/verifier need without constructing instances.
 */
export interface SqlControlExtensionDescriptor<TTargetId extends string>
  extends ControlExtensionDescriptor<'sql', TTargetId> {
  /** Optional database dependencies this extension requires. */
  readonly databaseDependencies?: ComponentDatabaseDependencies<unknown>;
}

// ============================================================================
// SQL-Specific Plan Types
// ============================================================================

/**
 * A single step in a SQL migration operation (precheck, execute, or postcheck).
 */
export interface SqlMigrationPlanOperationStep {
  readonly description: string;
  readonly sql: string;
  readonly meta?: AnyRecord;
}

/**
 * Target details for a SQL migration operation (table, column, index, etc.).
 */
export interface SqlMigrationPlanOperationTarget<TTargetDetails> {
  readonly id: string;
  readonly details?: TTargetDetails;
}

/**
 * A single SQL migration operation with SQL-specific fields.
 * Extends the core MigrationPlanOperation with SQL execution details.
 */
export interface SqlMigrationPlanOperation<TTargetDetails> extends MigrationPlanOperation {
  /** Optional detailed explanation of what this operation does and why. */
  readonly summary?: string;
  readonly target: SqlMigrationPlanOperationTarget<TTargetDetails>;
  readonly precheck: readonly SqlMigrationPlanOperationStep[];
  readonly execute: readonly SqlMigrationPlanOperationStep[];
  readonly postcheck: readonly SqlMigrationPlanOperationStep[];
  readonly meta?: AnyRecord;
}

/**
 * Contract identity information for SQL migrations.
 */
export interface SqlMigrationPlanContractInfo {
  readonly coreHash: string;
  readonly profileHash?: string;
}

/**
 * A SQL migration plan with SQL-specific fields.
 * Extends the core MigrationPlan with origin tracking and metadata.
 */
export interface SqlMigrationPlan<TTargetDetails> extends MigrationPlan {
  /**
   * Origin contract identity that the plan expects the database to currently be at.
   * If omitted, the runner treats the origin as "no marker present" (empty database),
   * and will only proceed if no marker exists (or if the marker already matches destination).
   */
  readonly origin?: SqlMigrationPlanContractInfo | null;
  /**
   * Destination contract identity that the plan intends to reach.
   */
  readonly destination: SqlMigrationPlanContractInfo;
  readonly operations: readonly SqlMigrationPlanOperation<TTargetDetails>[];
  readonly meta?: AnyRecord;
}

// ============================================================================
// SQL-Specific Planner Types
// ============================================================================

/**
 * Specific conflict kinds for SQL migrations.
 */
export type SqlPlannerConflictKind =
  | 'typeMismatch'
  | 'nullabilityConflict'
  | 'indexIncompatible'
  | 'foreignKeyConflict'
  | 'missingButNonAdditive'
  | 'unsupportedExtension'
  | 'extensionMissing'
  | 'unsupportedOperation'
  | 'enumValuesMismatch';

/**
 * Location information for SQL planner conflicts.
 */
export interface SqlPlannerConflictLocation {
  readonly table?: string;
  readonly column?: string;
  readonly index?: string;
  readonly constraint?: string;
  readonly extension?: string;
  readonly enum?: string;
}

/**
 * A SQL-specific planner conflict with additional location information.
 * Extends the core MigrationPlannerConflict.
 */
export interface SqlPlannerConflict extends MigrationPlannerConflict {
  readonly kind: SqlPlannerConflictKind;
  readonly location?: SqlPlannerConflictLocation;
  readonly meta?: AnyRecord;
}

/**
 * Successful SQL planner result with the migration plan.
 */
export interface SqlPlannerSuccessResult<TTargetDetails>
  extends Omit<MigrationPlannerSuccessResult, 'plan'> {
  readonly kind: 'success';
  readonly plan: SqlMigrationPlan<TTargetDetails>;
}

/**
 * Failed SQL planner result with the list of conflicts.
 */
export interface SqlPlannerFailureResult extends Omit<MigrationPlannerFailureResult, 'conflicts'> {
  readonly kind: 'failure';
  readonly conflicts: readonly SqlPlannerConflict[];
}

/**
 * Union type for SQL planner results.
 */
export type SqlPlannerResult<TTargetDetails> =
  | SqlPlannerSuccessResult<TTargetDetails>
  | SqlPlannerFailureResult;

/**
 * Options for SQL migration planner.
 */
export interface SqlMigrationPlannerPlanOptions {
  readonly contract: SqlContract<SqlStorage>;
  readonly schema: SqlSchemaIR;
  readonly policy: MigrationOperationPolicy;
  readonly schemaName?: string;
  /**
   * Active framework components participating in this composition.
   * SQL targets can interpret this list to derive database dependencies.
   * All components must have matching familyId ('sql') and targetId.
   */
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

/**
 * SQL migration planner interface.
 * Extends the core MigrationPlanner with SQL-specific types.
 */
export interface SqlMigrationPlanner<TTargetDetails> {
  plan(options: SqlMigrationPlannerPlanOptions): SqlPlannerResult<TTargetDetails>;
}

// ============================================================================
// SQL-Specific Runner Types
// ============================================================================

/**
 * Callbacks for SQL migration runner execution.
 */
export interface SqlMigrationRunnerExecuteCallbacks<TTargetDetails> {
  onOperationStart?(operation: SqlMigrationPlanOperation<TTargetDetails>): void;
  onOperationComplete?(operation: SqlMigrationPlanOperation<TTargetDetails>): void;
}

/**
 * Options for SQL migration runner execution.
 */
export interface SqlMigrationRunnerExecuteOptions<TTargetDetails> {
  readonly plan: SqlMigrationPlan<TTargetDetails>;
  readonly driver: ControlDriverInstance<'sql', string>;
  /**
   * Destination contract IR.
   * Must correspond to `plan.destination` and is used for schema verification and marker/ledger writes.
   */
  readonly destinationContract: SqlContract<SqlStorage>;
  /**
   * Execution-time policy that defines which operation classes are allowed.
   * The runner validates each operation against this policy before execution.
   */
  readonly policy: MigrationOperationPolicy;
  readonly schemaName?: string;
  readonly strictVerification?: boolean;
  readonly callbacks?: SqlMigrationRunnerExecuteCallbacks<TTargetDetails>;
  readonly context?: OperationContext;
  /**
   * Execution-time checks configuration.
   * All checks default to `true` (enabled) when omitted.
   */
  readonly executionChecks?: MigrationRunnerExecutionChecks;
  /**
   * Active framework components participating in this composition.
   * SQL targets can interpret this list to derive database dependencies.
   * All components must have matching familyId ('sql') and targetId.
   */
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

/**
 * Error codes for SQL migration runner failures.
 */
export type SqlMigrationRunnerErrorCode =
  | 'DESTINATION_CONTRACT_MISMATCH'
  | 'MARKER_ORIGIN_MISMATCH'
  | 'POLICY_VIOLATION'
  | 'PRECHECK_FAILED'
  | 'POSTCHECK_FAILED'
  | 'SCHEMA_VERIFY_FAILED'
  | 'EXECUTION_FAILED';

/**
 * Detailed information about a SQL migration runner failure.
 * Extends the core MigrationRunnerFailure with SQL-specific error codes.
 */
export interface SqlMigrationRunnerFailure extends MigrationRunnerFailure {
  readonly code: SqlMigrationRunnerErrorCode;
  readonly meta?: AnyRecord;
}

/**
 * Success value for SQL migration runner execution.
 * Extends core type for type branding and potential SQL-specific extensions.
 */
export interface SqlMigrationRunnerSuccessValue extends MigrationRunnerSuccessValue {}

/**
 * Result type for SQL migration runner execution.
 */
export type SqlMigrationRunnerResult = Result<
  SqlMigrationRunnerSuccessValue,
  SqlMigrationRunnerFailure
>;

/**
 * SQL migration runner interface.
 * Extends the core MigrationRunner with SQL-specific types.
 */
export interface SqlMigrationRunner<TTargetDetails> {
  execute(
    options: SqlMigrationRunnerExecuteOptions<TTargetDetails>,
  ): Promise<SqlMigrationRunnerResult>;
}

// ============================================================================
// SQL Control Target Descriptor
// ============================================================================

/**
 * SQL control target descriptor with migration support.
 * Extends the core ControlTargetDescriptor with SQL-specific migration methods.
 */
export interface SqlControlTargetDescriptor<TTargetId extends string, TTargetDetails>
  extends ControlTargetDescriptor<
    'sql',
    TTargetId,
    ControlTargetInstance<'sql', TTargetId>,
    SqlControlFamilyInstance
  > {
  /**
   * Creates a SQL migration planner for this target.
   * Direct method for SQL-specific usage.
   */
  createPlanner(family: SqlControlFamilyInstance): SqlMigrationPlanner<TTargetDetails>;
  /**
   * Creates a SQL migration runner for this target.
   * Direct method for SQL-specific usage.
   */
  createRunner(family: SqlControlFamilyInstance): SqlMigrationRunner<TTargetDetails>;
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Options for creating a SQL migration plan.
 */
export interface CreateSqlMigrationPlanOptions<TTargetDetails> {
  readonly targetId: string;
  readonly origin?: SqlMigrationPlanContractInfo | null;
  readonly destination: SqlMigrationPlanContractInfo;
  readonly operations: readonly SqlMigrationPlanOperation<TTargetDetails>[];
  readonly meta?: AnyRecord;
}
