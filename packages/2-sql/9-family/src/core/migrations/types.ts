import type { Contract } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  ControlAdapterDescriptor,
  ControlDriverInstance,
  ControlExtensionDescriptor,
  MigratableTargetDescriptor,
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
  OpFactoryCall,
  SchemaIssue,
} from '@prisma-next/framework-components/control';
import type { MigrationPackage } from '@prisma-next/migration-tools/package';
import type {
  SqlStorage,
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import type { SqlOperationDescriptor } from '@prisma-next/sql-operations';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import type { Result } from '@prisma-next/utils/result';
import type { SqlControlFamilyInstance } from '../control-instance';

export type AnyRecord = Readonly<Record<string, unknown>>;

export interface StorageTypePlanResult<TTargetDetails> {
  readonly operations: readonly SqlMigrationPlanOperation<TTargetDetails>[];
}

/**
 * Input for expanding parameterized native types.
 */
export interface ExpandNativeTypeInput {
  readonly nativeType: string;
  readonly codecId?: string;
  readonly typeParams?: Record<string, unknown>;
}

/**
 * Input for resolving an identity-value SQL literal used to backfill existing rows when
 * adding a NOT NULL column without an explicit default.
 *
 * "Identity value" in the algebraic (monoid) sense: the neutral element for the type
 * (0 for numbers, '' for strings, false for booleans, etc.).
 */
export interface ResolveIdentityValueInput {
  readonly nativeType: string;
  readonly codecId?: string;
  readonly typeParams?: Record<string, unknown>;
}

/**
 * Per-field lifecycle event a codec hook can react to.
 *
 * Fired during app-space migration emission as the SQL family diffs the
 * prior contract against the new contract. See
 * `docs/architecture docs/adrs/ADR 212 - Codec lifecycle hooks.md`
 * for the wiring contract.
 *
 * - `'added'`     — the field is present in the new contract but not the prior.
 * - `'dropped'`   — the field is present in the prior contract but not the new.
 * - `'altered'`   — the field is present in both and any property other than
 *                   `codecId` differs. Codec-id changes are a v1 non-goal:
 *                   when only `codecId` differs, no `'altered'` event fires.
 */
export type FieldEvent = 'added' | 'dropped' | 'altered';

/**
 * Context passed to {@link CodecControlHooks.onFieldEvent}.
 *
 * `tableName` and `fieldName` are always populated; `priorTable` /
 * `priorField` carry the prior contract's view of the table and column
 * (present for `'dropped'` and `'altered'`); `newTable` / `newField`
 * carry the new contract's view (present for `'added'` and `'altered'`).
 *
 * The hook only ever receives app-space contract IR — extension-space
 * fields are scoped out by the API: the sub-spec wires the hook at the
 * application emitter only.
 */
export interface FieldEventContext {
  readonly tableName: string;
  readonly fieldName: string;
  readonly priorTable?: StorageTable;
  readonly newTable?: StorageTable;
  readonly priorField?: StorageColumn;
  readonly newField?: StorageColumn;
}

export interface CodecControlHooks<TTargetDetails = unknown> {
  planTypeOperations?: (options: {
    readonly typeName: string;
    readonly typeInstance: StorageTypeInstance;
    readonly contract: Contract<SqlStorage>;
    readonly schema: SqlSchemaIR;
    readonly schemaName?: string;
    readonly policy: MigrationOperationPolicy;
  }) => StorageTypePlanResult<TTargetDetails>;
  verifyType?: (options: {
    readonly typeName: string;
    readonly typeInstance: StorageTypeInstance;
    readonly schema: SqlSchemaIR;
    readonly schemaName?: string;
  }) => readonly SchemaIssue[];
  introspectTypes?: (options: {
    readonly driver: ControlDriverInstance<'sql', string>;
    readonly schemaName?: string;
  }) => Promise<Record<string, StorageTypeInstance>>;
  /**
   * Expands a parameterized native type to its full SQL representation.
   * Used by schema verification to compare contract types against database types.
   *
   * For example, expands:
   * - { nativeType: 'character varying', typeParams: { length: 255 } } -> 'character varying(255)'
   * - { nativeType: 'numeric', typeParams: { precision: 10, scale: 2 } } -> 'numeric(10,2)'
   *
   * Returns the expanded type string, or the original nativeType if no expansion is needed.
   */
  expandNativeType?: (input: ExpandNativeTypeInput) => string;
  /**
   * Resolves the identity value (monoid neutral element) as a SQL literal for safely adding
   * a NOT NULL column without an explicit default to a non-empty table.
   *
   * Return semantics:
   * - string: use this literal
   * - null: explicitly no safe identity value is known; fall back to another strategy
   * - undefined: no opinion; planner may use built-in fallbacks
   */
  resolveIdentityValue?: (input: ResolveIdentityValueInput) => string | null | undefined;
  /**
   * Reacts to per-field added / dropped / altered events as the app-space
   * emitter diffs the prior contract against the new contract. Returned
   * Calls flow through the planner's IR alongside the target's structural
   * DDL — the renderer emits each Call's `renderTypeScript()` into the
   * generated `migration.ts`, and `toOp()` derives the runtime op for
   * `ops.json`.
   *
   * Returning the framework `OpFactoryCall` interface (rather than a flat
   * `SqlMigrationPlanOperation[]`) is what lets codec contributions
   * render as factory calls (e.g. `cipherstashAddSearchConfig({...})`)
   * instead of `rawSql({...})` blocks. Each Call must implement the
   * full interface from `@prisma-next/framework-components/control` —
   * see ADR 195 for the two-renderer pattern.
   *
   * Synchronous. Hooks are dispatched per `(table, field)` based on the
   * field's `codecId` (the new field's codec for `'added'` / `'altered'`;
   * the prior field's codec for `'dropped'`).
   *
   * See `docs/architecture docs/adrs/ADR 212 - Codec lifecycle hooks.md`
   * for the wiring contract and the deterministic ordering rule.
   */
  onFieldEvent?: (event: FieldEvent, ctx: FieldEventContext) => readonly OpFactoryCall[];
}

/**
 * Pinned head ref for a contract space — the `(hash, invariants)` tuple a
 * runner targets when applying that space's migration graph. Identical in
 * shape to the on-disk `migrations/<space-id>/refs/head.json` the framework
 * writes per loaded extension.
 *
 * Project: extension contract spaces (TML-2397). See
 * `docs/architecture docs/adrs/ADR 211 - Contract spaces.md`.
 */
export interface ExtensionContractRef {
  readonly hash: string;
  readonly invariants: readonly string[];
}

/**
 * Contract-space view an extension publishes through its descriptor
 * module: the canonical contract value, the migration graph authored
 * against it, and the pinned head ref. The framework reads this value
 * only at authoring time (during `migrate`); apply / verify paths read
 * the user's repo (`migrations/<space-id>/...`) instead.
 *
 * The expected authoring convention is **on-disk-in-package**: the
 * extension's package directory contains its own emitted artefacts
 * (`contract.json`, `migrations/<space-id>/<dirName>/...`, and
 * `refs/head.json`) produced by the same `prisma-next contract emit`
 * + `prisma-next migration plan` pipeline application authors use.
 * The descriptor module wires those JSON artefacts via JSON-import
 * declarations (`import x from '../path' with { type: 'json' }`) and
 * synthesises {@link MigrationPackage} values whose `dirPath` points
 * at the on-disk migration directory (typically resolved from
 * `import.meta.url`). See
 * `docs/architecture docs/adrs/ADR 211 - Contract spaces.md` for the
 * full convention and `packages/3-extensions/test-contract-space/`
 * for the reference model.
 */
export interface ExtensionContractSpace {
  readonly contractJson: Contract<SqlStorage>;
  readonly migrations: readonly MigrationPackage[];
  readonly headRef: ExtensionContractRef;
}

export interface SqlControlExtensionDescriptor<TTargetId extends string>
  extends ControlExtensionDescriptor<'sql', TTargetId> {
  readonly queryOperations?: () => ReadonlyArray<SqlOperationDescriptor>;
  /**
   * Schema-contributing extensions opt into the per-space planner / runner /
   * verifier by setting this field. Extensions without it are codec-only or
   * query-ops-only — today's behaviour preserved.
   */
  readonly contractSpace?: ExtensionContractSpace;
}

export interface SqlControlAdapterDescriptor<TTargetId extends string>
  extends ControlAdapterDescriptor<'sql', TTargetId> {
  readonly queryOperations?: () => ReadonlyArray<SqlOperationDescriptor>;
}

export interface SqlMigrationPlanOperationStep {
  readonly description: string;
  readonly sql: string;
  /**
   * Optional parameter values bound at execution time. The runner forwards
   * these to `driver.query(sql, params ?? [])`, so step authors can use
   * placeholder syntax (`$1`, `$2`, …) instead of inlining literals into
   * the SQL string. Reuses the driver's parameter binder rather than
   * rolling per-target literal serialization for every type the planner
   * may emit.
   */
  readonly params?: readonly unknown[];
  readonly meta?: AnyRecord;
}

/**
 * Minimal shape every SQL-family target must conform to for its per-operation
 * `target.details` payload. Each SQL operation addresses a named database
 * object in some schema; targets (Postgres, MySQL, SQLite, …) extend this
 * shape with their own fields (e.g. Postgres adds `objectType` and optional
 * `table`).
 */
export interface SqlPlanTargetDetails {
  readonly schema: string;
  readonly name: string;
}

export interface SqlMigrationPlanOperationTarget<TTargetDetails> {
  readonly id: string;
  readonly details?: TTargetDetails;
}

export interface SqlMigrationPlanOperation<TTargetDetails> extends MigrationPlanOperation {
  readonly summary?: string;
  readonly target: SqlMigrationPlanOperationTarget<TTargetDetails>;
  readonly precheck: readonly SqlMigrationPlanOperationStep[];
  readonly execute: readonly SqlMigrationPlanOperationStep[];
  readonly postcheck: readonly SqlMigrationPlanOperationStep[];
  readonly meta?: AnyRecord;
}

export interface SqlMigrationPlanContractInfo {
  readonly storageHash: string;
  readonly profileHash?: string;
}

export interface SqlMigrationPlan<TTargetDetails> extends MigrationPlan {
  /**
   * Origin contract identity that the plan expects the database to currently be at.
   * If omitted or null, the runner skips origin validation entirely.
   */
  readonly origin?: SqlMigrationPlanContractInfo | null;
  /**
   * Destination contract identity that the plan intends to reach.
   */
  readonly destination: SqlMigrationPlanContractInfo;
  readonly operations: readonly SqlMigrationPlanOperation<TTargetDetails>[];
  /**
   * Sorted, deduplicated invariant ids declared by this plan's data-transform
   * ops. Required at the SQL-family layer (the SQL runners consume this as
   * the source of truth for marker writes and self-edge no-op checks); the
   * framework-level {@link MigrationPlan.providedInvariants} stays optional
   * because `db init` / `db update` plans don't have a corresponding
   * migration manifest.
   */
  readonly providedInvariants: readonly string[];
  readonly meta?: AnyRecord;
}

export type SqlPlannerConflictKind =
  | 'typeMismatch'
  | 'nullabilityConflict'
  | 'indexIncompatible'
  | 'foreignKeyConflict'
  | 'missingButNonAdditive'
  | 'unsupportedOperation';

export interface SqlPlannerConflictLocation {
  readonly table?: string;
  readonly column?: string;
  readonly index?: string;
  readonly constraint?: string;
  readonly type?: string;
}

export interface SqlPlannerConflict extends MigrationPlannerConflict {
  readonly kind: SqlPlannerConflictKind;
  readonly location?: SqlPlannerConflictLocation;
  readonly meta?: AnyRecord;
}

export interface SqlPlannerSuccessResult<TTargetDetails>
  extends Omit<MigrationPlannerSuccessResult, 'plan'> {
  readonly kind: 'success';
  readonly plan: SqlMigrationPlan<TTargetDetails>;
}

export interface SqlPlannerFailureResult extends Omit<MigrationPlannerFailureResult, 'conflicts'> {
  readonly kind: 'failure';
  readonly conflicts: readonly SqlPlannerConflict[];
}

export type SqlPlannerResult<TTargetDetails> =
  | SqlPlannerSuccessResult<TTargetDetails>
  | SqlPlannerFailureResult;

export interface SqlMigrationPlannerPlanOptions {
  readonly contract: Contract<SqlStorage>;
  readonly schema: SqlSchemaIR;
  readonly policy: MigrationOperationPolicy;
  readonly schemaName?: string;
  /**
   * The "from" contract (state the planner assumes the database starts at),
   * or `null` for reconciliation flows that have no prior contract.
   *
   * Required at every call site so the structural fact "I have a prior
   * contract / I don't" is visible in the type. `migration plan` supplies
   * the previous bundle's `metadata.toContract`; `db update` / `db init`
   * reconcile against the live schema and pass `null`. Strategies that
   * need from/to column-shape comparisons (unsafe type change, nullability
   * tightening) use this to decide whether to emit `dataTransform`
   * placeholders; they short-circuit when it is `null`.
   *
   * Planners also derive the "from" identity they stamp onto the produced
   * plan's `describe()` as `fromContract?.storage.storageHash ?? null`.
   */
  readonly fromContract: Contract<SqlStorage> | null;
  /**
   * Active framework components participating in this composition.
   * SQL targets can interpret this list to derive database dependencies.
   * All components must have matching familyId ('sql') and targetId.
   */
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

export interface SqlMigrationPlanner<TTargetDetails> {
  plan(options: SqlMigrationPlannerPlanOptions): SqlPlannerResult<TTargetDetails>;
}

export interface SqlMigrationRunnerExecuteCallbacks<TTargetDetails> {
  onOperationStart?(operation: SqlMigrationPlanOperation<TTargetDetails>): void;
  onOperationComplete?(operation: SqlMigrationPlanOperation<TTargetDetails>): void;
}

export interface SqlMigrationRunnerExecuteOptions<TTargetDetails> {
  readonly plan: SqlMigrationPlan<TTargetDetails>;
  readonly driver: ControlDriverInstance<'sql', string>;
  /**
   * Logical contract space this plan applies to. Defaults to
   * `'app'` so existing single-space callers keep working without
   * modification. Multi-space callers supply each space's id explicitly so the marker
   * write goes against the right row.
   */
  readonly space?: string;
  /**
   * Destination contract IR.
   * Must correspond to `plan.destination` and is used for schema verification and marker/ledger writes.
   */
  readonly destinationContract: Contract<SqlStorage>;
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

export type SqlMigrationRunnerErrorCode =
  | 'DESTINATION_CONTRACT_MISMATCH'
  | 'MARKER_ORIGIN_MISMATCH'
  | 'POLICY_VIOLATION'
  | 'PRECHECK_FAILED'
  | 'POSTCHECK_FAILED'
  | 'SCHEMA_VERIFY_FAILED'
  | 'FOREIGN_KEY_VIOLATION'
  | 'EXECUTION_FAILED';

export interface SqlMigrationRunnerFailure extends MigrationRunnerFailure {
  readonly code: SqlMigrationRunnerErrorCode;
  readonly meta?: AnyRecord;
}

export interface SqlMigrationRunnerSuccessValue extends MigrationRunnerSuccessValue {}

export type SqlMigrationRunnerResult = Result<
  SqlMigrationRunnerSuccessValue,
  SqlMigrationRunnerFailure
>;

export interface SqlMigrationRunner<TTargetDetails> {
  /**
   * Apply a single migration plan, opening and managing its own
   * transaction (and any target-specific connection-level setup, e.g.
   * SQLite's `PRAGMA foreign_keys` toggle). Existing single-space
   * callers route through here.
   */
  execute(
    options: SqlMigrationRunnerExecuteOptions<TTargetDetails>,
  ): Promise<SqlMigrationRunnerResult>;

  /**
   * Apply a single migration plan against an already-open connection
   * **without** opening a transaction. The caller is responsible for
   * wrapping the call (and any siblings) in `BEGIN` / `COMMIT` /
   * `ROLLBACK`. Used by the per-space runner wiring to
   * fan out across contract spaces inside one outer transaction so a
   * mid-apply failure rolls back every space's writes.
   *
   * Idempotent control-table setup (`prisma_contract.*`) and marker
   * writes use `options.space` to address the per-space marker row.
   */
  executeOnConnection(
    options: SqlMigrationRunnerExecuteOptions<TTargetDetails>,
  ): Promise<SqlMigrationRunnerResult>;

  /**
   * Apply per-space plans across multiple contract spaces inside a
   * single outer transaction. The caller orders the input list
   * (typically via {@link import('@prisma-next/migration-tools/spaces').concatenateSpaceApplyInputs});
   * the runner is responsible for opening / committing the outer
   * transaction (and any target-specific connection-level setup such
   * as the SQLite FK pragma toggle). A failure on any space rolls
   * back every space's writes — the all-or-nothing rollback guarantee.
   *
   * Each space's `SqlMigrationRunnerExecuteOptions` must reference the
   * same `driver` (the connection the outer transaction is open on).
   * Per-space marker writes use `options.space` to address the row.
   */
  executeAcrossSpaces(options: {
    readonly driver: ControlDriverInstance<'sql', string>;
    readonly perSpaceOptions: ReadonlyArray<SqlMigrationRunnerExecuteOptions<TTargetDetails>>;
  }): Promise<MultiSpaceRunnerResult>;
}

export interface MultiSpaceRunnerSuccessValue {
  readonly perSpaceResults: ReadonlyArray<{
    readonly space: string;
    readonly value: SqlMigrationRunnerSuccessValue;
  }>;
}

export interface MultiSpaceRunnerFailure extends SqlMigrationRunnerFailure {
  readonly failingSpace: string;
}

export type MultiSpaceRunnerResult = Result<MultiSpaceRunnerSuccessValue, MultiSpaceRunnerFailure>;

export interface SqlControlTargetDescriptor<TTargetId extends string, TTargetDetails>
  extends MigratableTargetDescriptor<'sql', TTargetId, SqlControlFamilyInstance> {
  readonly queryOperations?: () => ReadonlyArray<SqlOperationDescriptor>;
  createPlanner(family: SqlControlFamilyInstance): SqlMigrationPlanner<TTargetDetails>;
  createRunner(family: SqlControlFamilyInstance): SqlMigrationRunner<TTargetDetails>;
}

export interface CreateSqlMigrationPlanOptions<TTargetDetails> {
  readonly targetId: string;
  readonly origin?: SqlMigrationPlanContractInfo | null;
  readonly destination: SqlMigrationPlanContractInfo;
  readonly operations: readonly SqlMigrationPlanOperation<TTargetDetails>[];
  /**
   * Sorted, deduplicated invariant ids for this plan; mirrors the required
   * field on {@link SqlMigrationPlan}. Callers without a migration manifest
   * (`db init`, `db update`, planner-built plans) pass `[]`.
   */
  readonly providedInvariants: readonly string[];
  readonly meta?: AnyRecord;
}
