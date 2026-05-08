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
import type { TargetBoundComponentDescriptor } from '../shared/framework-components';
import type { ControlDriverInstance, ControlFamilyInstance } from './control-instances';

// ============================================================================
// Migration Package Metadata
// ============================================================================

/**
 * Planner provenance recorded inside {@link MigrationMetadata}.
 *
 * `used` / `applied` track which migration hints the planner consulted
 * vs. which it actually applied during emission; `plannerVersion`
 * pins the planner build that produced the migration so future
 * verification passes can recognise plans authored against an older
 * planner.
 */
export interface MigrationHints {
  readonly used: readonly string[];
  readonly applied: readonly string[];
  readonly plannerVersion: string;
}

/**
 * In-memory migration metadata envelope. Every migration is
 * content-addressed: the `migrationHash` is a hash over the metadata
 * envelope plus the operations list, computed at write time. There is no
 * draft state — a migration directory either exists with fully attested
 * metadata or it does not.
 *
 * When the planner cannot lower an operation because of an unfilled
 * `placeholder(...)` slot, the migration is still written with
 * `migrationHash` hashed over `ops: []`. Re-running self-emit after the
 * user fills the placeholder produces a *different* `migrationHash`
 * (committed to the real ops); this is intentional.
 *
 * The on-disk JSON shape in `migration.json` matches this type
 * field-for-field — `JSON.stringify(metadata, null, 2)` is the canonical
 * writer output (defined in `@prisma-next/migration-tools/io`).
 */
export interface MigrationMetadata {
  readonly migrationHash: string;
  readonly from: string | null;
  readonly to: string;
  readonly fromContract: Contract | null;
  readonly toContract: Contract;
  readonly hints: MigrationHints;
  readonly labels: readonly string[];
  /**
   * Sorted, deduplicated list of `invariantId`s declared by the
   * migration's data-transform ops. Always present; an empty array
   * means the migration has no routing-visible data transforms.
   */
  readonly providedInvariants: readonly string[];
  readonly authorship?: { readonly author?: string; readonly email?: string };
  readonly signature?: { readonly keyId: string; readonly value: string } | null;
  readonly createdAt: string;
}

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
// Serialized Query Plan
// ============================================================================

/**
 * A lowered query statement as stored in ops.json.
 * Contains the SQL string and parameter values — ready for execution.
 * Lowering from query builder AST to SQL happens at verify time.
 *
 * The Postgres `dataTransform` factory uses this shape internally to
 * carry the user's lowered `check`/`run` plans before wrapping them
 * into precheck/execute/postcheck steps on the unified migration op.
 */
export interface SerializedQueryPlan {
  readonly sql: string;
  readonly params: readonly unknown[];
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
  /**
   * Optional opt-in routing identity for data-transform operations.
   * Presence opts the transform into invariant-aware routing; absence
   * means it is path-dependent and not referenceable from refs.
   *
   * Lives on the base op so the manifest emitter and
   * `deriveProvidedInvariants` can read it without depending on a
   * target-specific shape. Schema-DDL ops (additive / widening /
   * destructive) leave it undefined.
   */
  readonly invariantId?: string;
}

// ============================================================================
// Planner IR — Op Factory Calls
// ============================================================================

/**
 * Framework-level contract for a single factory call in a target's planner IR.
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
  /**
   * Sorted, deduplicated invariant ids declared by this plan's data-transform
   * ops. Authored migrations carry the canonical value from
   * `migration.json.providedInvariants`; planner-built plans (`db init`,
   * `db update`) omit it (the runner treats it as `[]`). Runners read this
   * field for marker writes and self-edge no-op detection rather than
   * re-deriving from `operations`, since the manifest is the canonical
   * source for the invariant set across all runners (postgres, sqlite,
   * mongo).
   */
  readonly providedInvariants?: readonly string[];
}

/**
 * A migration plan that can also render itself back to user-editable
 * TypeScript source (a `migration.ts` file).
 *
 * Planners produce this richer shape so that CLI commands can both:
 *  - hand the plan to the runner for execution (via `MigrationPlan`), and
 *  - materialize the plan as an editable source file via `renderTypeScript()`.
 *
 * User-authored migrations (`Migration` subclasses) satisfy `MigrationPlan`
 * but not this interface: they are already the source.
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
 * uniformly ask any plan to render itself to TypeScript.
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
     * The "from" contract (the state the planner assumes the database starts
     * at), or `null` for a baseline plan with no prior state.
     *
     * Planners derive any "from" identity they need to stamp onto the
     * produced plan's `describe()` from `fromContract?.storage.storageHash
     * ?? null`. They also pass this to data-safety strategies so they can
     * compare `from` and `to` column shapes (e.g. to detect unsafe type
     * changes).
     *
     * Required at every call site to make the structural fact "I have a
     * prior contract / I don't" visible in the type. Reconciliation
     * commands (`db init`, `db update`) introspect a live schema and pass
     * `null`; authoring commands (`migration plan`) pass the previous
     * bundle's `metadata.toContract`.
     */
    readonly fromContract: Contract | null;
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
   * Used by `migration new` to scaffold a fresh `migration.ts`. The
   * returned plan has no operations; its `renderTypeScript()` yields a
   * stub the user can edit.
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
  /**
   * Execute a migration plan against the configured driver.
   *
   * The `plan` parameter is trusted input. Callers are responsible for
   * upstream verification of the originating migration package — typically
   * by obtaining the package via `readMigrationPackage` from
   * `@prisma-next/migration-tools/io`, which performs hash-integrity checks
   * at the load boundary. Runners do not re-verify the plan and assume the
   * `(metadata, ops)` pair on disk has not been tampered with since emit.
   */
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
   * Storage hash of the "from" contract, or `null` for a baseline scaffold
   * with no prior state. Targets use this to populate `describe()` on the
   * rendered empty migration so that identity metadata is correctly
   * populated.
   */
  readonly fromHash: string | null;
  /**
   * Storage hash of the "to" contract. Same purpose as `fromHash` — threaded
   * through so the rendered class's `describe()` declares the correct
   * destination identity.
   */
  readonly toHash: string;
}
