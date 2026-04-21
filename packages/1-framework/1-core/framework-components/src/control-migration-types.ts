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
// Planner IR — Op Factory Calls
// ============================================================================

/**
 * Framework-level contract for a single factory call in a target's class-flow
 * planner IR.
 *
 * @see ADR 195
 */
export interface OpFactoryCall {
  /** The name of the factory that would produce this call's runtime op. */
  readonly factoryName: string;
  /** The operation's safety class (additive, widening, destructive, data). */
  readonly operationClass: MigrationOperationClass;
  /** Human-readable label for CLI output and diagnostics. */
  readonly label: string;
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

/**
 * A migration plan that can also render itself back to user-editable
 * TypeScript source (a `migration.ts` file).
 *
 * Planners produce this richer shape so that CLI commands can both:
 *  - hand the plan to the runner for execution (via `MigrationPlan`), and
 *  - materialize the plan as an editable source file via `renderTypeScript()`.
 *
 * User-authored migrations (class-flow `Migration` subclasses) satisfy
 * `MigrationPlan` but not this interface: they are already the source.
 *
 * Descriptor-flow targets (e.g. Postgres) that do not materialize their
 * planner plans back to TypeScript provide a throwing stub so that
 * `MigrationPlannerSuccessResult.plan` has a uniform type at the framework
 * level. In practice the CLI only calls `renderTypeScript()` in the
 * class-flow branch of `migration plan`.
 */
export interface MigrationPlanWithAuthoringSurface extends MigrationPlan {
  /**
   * Render this plan back to TypeScript source suitable for writing to
   * `migration.ts`. Output may start with a shebang; when it does, the caller
   * should make the resulting file executable.
   */
  renderTypeScript(): string;
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
 *
 * The plan is typed as `MigrationPlanWithAuthoringSurface` so the CLI can
 * uniformly ask any plan to render itself to TypeScript. Targets whose
 * planners do not support that (descriptor-flow targets like Postgres)
 * supply a throwing `renderTypeScript()` stub — the CLI only calls it in
 * the class-flow branch of `migration plan`.
 */
export interface MigrationPlannerSuccessResult {
  readonly kind: 'success';
  readonly plan: MigrationPlanWithAuthoringSurface;
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
     * Storage hash of the "from" contract (the state the planner assumes the
     * database starts at). Class-flow planners use this to populate
     * `describe()` on the produced plan so the rendered `migration.ts` has
     * correct `from`/`to` metadata.
     */
    readonly fromHash: string;
    /**
     * The "from" contract (the state the planner assumes the database starts
     * at). Class-flow planners pass this to data-safety strategies so they
     * can compare `from` and `to` column shapes (e.g. to detect unsafe type
     * changes). `db update` / `db init` reconcile against the live schema and
     * have no "from" contract; only `migration plan` provides one.
     */
    readonly fromContract?: unknown;
    /**
     * Active framework components participating in this composition.
     * Families/targets can interpret this list to derive family-specific metadata.
     * All components must have matching familyId and targetId.
     */
    readonly frameworkComponents: ReadonlyArray<
      TargetBoundComponentDescriptor<TFamilyId, TTargetId>
    >;
  }): MigrationPlannerResult;

  /**
   * Produce an empty migration with the target's authoring conventions.
   *
   * Used by `migration new` to scaffold a fresh `migration.ts` without the
   * CLI needing to know whether the target uses descriptor-flow or class-flow
   * authoring. The returned plan has no operations; its `renderTypeScript()`
   * yields a stub the user can edit.
   */
  emptyMigration(context: MigrationScaffoldContext): MigrationPlanWithAuthoringSurface;
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
   * Optional: in-process emit capability for class-flow migration files.
   *
   * Targets that author `migration.ts` as an executable class implement
   * `emit` to produce `ops.json` from the source file directly. The
   * framework dispatches to `emit` whenever the CLI needs to serialize a
   * migration's operations for storage or display.
   *
   * The capability runs in the same Node process as the CLI:
   *  - The target dynamically imports `<dir>/migration.ts`, locates the
   *    authored class on the module's default export, and invokes whatever
   *    runtime machinery it needs to obtain the operations list.
   *  - Structured errors thrown during evaluation (notably
   *    `errorUnfilledPlaceholder` with code `PN-MIG-2001`) propagate as
   *    real JS exceptions so the CLI's normal error envelope can render
   *    them with full structured metadata. No subprocess is spawned.
   *  - The target is responsible for calling `writeMigrationOps(dir, ops)`
   *    so that `ops.json` ends up on disk before `emit` returns. The
   *    framework's `emitMigration` helper is the single owner of
   *    `attestMigration(dir)` — the target MUST NOT call
   *    `attestMigration` itself.
   *  - The returned `MigrationPlanOperation[]` is the display-oriented
   *    shape the CLI uses for output (id, label, operationClass).
   */
  emit?(options: {
    readonly dir: string;
    readonly frameworkComponents: ReadonlyArray<
      TargetBoundComponentDescriptor<TFamilyId, TTargetId>
    >;
  }): Promise<readonly MigrationPlanOperation[]>;
}

// ============================================================================
// Migration Scaffolding SPI
// ============================================================================

/**
 * Context for rendering migration source files.
 *
 * Kept minimal: only the paths a target might need to compute relative imports
 * (e.g. the contract `.d.ts` import for typed-contract builders). Passed to
 * `MigrationPlanner.emptyMigration(context)`.
 */
export interface MigrationScaffoldContext {
  /** Absolute path to the migration package directory. Used by targets to compute relative imports. */
  readonly packageDir: string;
  /** Absolute path to the contract.json file, if one exists. Used by targets that emit typed-contract imports. */
  readonly contractJsonPath?: string;
  /**
   * Storage hash of the "from" contract. Class-flow targets (e.g. Mongo) use
   * this to populate `describe()` on the rendered empty migration so that
   * `migration.json` generated at emit time has correct identity metadata.
   */
  readonly fromHash: string;
  /**
   * Storage hash of the "to" contract. Same purpose as `fromHash` — threaded
   * through so the rendered class's `describe()` declares the correct
   * destination identity.
   */
  readonly toHash: string;
}
