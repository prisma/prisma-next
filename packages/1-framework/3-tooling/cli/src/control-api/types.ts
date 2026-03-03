import type {
  ContractSourceDiagnostics,
  ContractSourceProvider,
} from '@prisma-next/config/config-types';
import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type { CoreSchemaView } from '@prisma-next/core-control-plane/schema-view';
import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
  ControlTargetDescriptor,
  MigrationPlannerConflict,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import type { Result } from '@prisma-next/utils/result';

// ============================================================================
// Client Options
// ============================================================================

/**
 * Options for creating a control client.
 *
 * Note: This is NOT the same as CLI config. There's no `contract` field,
 * no file paths. The client is config-agnostic.
 *
 * The descriptor types use permissive `any` because family-specific descriptors
 * (e.g., SqlFamilyDescriptor) have more specific `create` method signatures that
 * are not compatible with the base ControlFamilyDescriptor type due to TypeScript
 * variance rules. The client implementation casts these internally.
 */
export interface ControlClientOptions {
  // biome-ignore lint/suspicious/noExplicitAny: required for contravariance - SqlFamilyDescriptor.create has specific parameter types
  readonly family: ControlFamilyDescriptor<any, any>;
  // biome-ignore lint/suspicious/noExplicitAny: required for contravariance - SqlControlTargetDescriptor extends with additional methods
  readonly target: ControlTargetDescriptor<any, any, any, any>;
  // biome-ignore lint/suspicious/noExplicitAny: required for contravariance in adapter.create()
  readonly adapter: ControlAdapterDescriptor<any, any, any>;
  /** Optional - control client can be created without driver for offline operations */
  // biome-ignore lint/suspicious/noExplicitAny: required for contravariance in driver.create()
  readonly driver?: ControlDriverDescriptor<any, any, any, any>;
  // biome-ignore lint/suspicious/noExplicitAny: required for contravariance in extension.create()
  readonly extensionPacks?: ReadonlyArray<ControlExtensionDescriptor<any, any, any>>;
  /**
   * Optional default connection for auto-connect.
   * When provided, operations will auto-connect if not already connected.
   * The type is driver-specific (e.g., string URL for Postgres).
   */
  readonly connection?: unknown;
}

// ============================================================================
// Progress Events
// ============================================================================

/**
 * Action names for control-api operations that can emit progress events.
 */
export type ControlActionName =
  | 'dbInit'
  | 'dbUpdate'
  | 'migrationApply'
  | 'verify'
  | 'schemaVerify'
  | 'sign'
  | 'introspect'
  | 'emit';

/**
 * Progress event emitted during control-api operation execution.
 *
 * Events model operation progress using a span-based model:
 * - `spanStart`: Begin a timed segment (supports nesting via parentSpanId)
 * - `spanEnd`: Complete a timed segment
 *
 * All operation-specific progress (e.g., per-migration-operation) is modeled
 * as nested spans rather than special event types.
 *
 * Events are delivered via an optional `onProgress` callback to avoid polluting
 * return types. If the callback is absent, operations emit no events (zero overhead).
 */
export type ControlProgressEvent =
  | {
      readonly action: ControlActionName;
      readonly kind: 'spanStart';
      readonly spanId: string;
      readonly parentSpanId?: string;
      readonly label: string;
    }
  | {
      readonly action: ControlActionName;
      readonly kind: 'spanEnd';
      readonly spanId: string;
      readonly outcome: 'ok' | 'skipped' | 'error';
    };

/**
 * Callback function for receiving progress events during control-api operations.
 *
 * @param event - The progress event emitted by the operation
 */
export type OnControlProgress = (event: ControlProgressEvent) => void;

// ============================================================================
// Operation Options
// ============================================================================

/**
 * Options for the verify operation.
 */
export interface VerifyOptions {
  /** Contract IR or unvalidated JSON - validated at runtime via familyInstance.validateContractIR() */
  readonly contractIR: unknown;
  /**
   * Database connection. If provided, verify will connect before executing.
   * If omitted, the client must already be connected.
   * The type is driver-specific (e.g., string URL for Postgres).
   */
  readonly connection?: unknown;
  /** Optional progress callback for observing operation progress */
  readonly onProgress?: OnControlProgress;
}

/**
 * Options for the schemaVerify operation.
 */
export interface SchemaVerifyOptions {
  /** Contract IR or unvalidated JSON - validated at runtime via familyInstance.validateContractIR() */
  readonly contractIR: unknown;
  /**
   * Whether to use strict mode for schema verification.
   * In strict mode, extra tables/columns are reported as issues.
   * Default: false (tolerant mode - allows superset)
   */
  readonly strict?: boolean;
  /**
   * Database connection. If provided, schemaVerify will connect before executing.
   * If omitted, the client must already be connected.
   * The type is driver-specific (e.g., string URL for Postgres).
   */
  readonly connection?: unknown;
  /** Optional progress callback for observing operation progress */
  readonly onProgress?: OnControlProgress;
}

/**
 * Options for the sign operation.
 */
export interface SignOptions {
  /** Contract IR or unvalidated JSON - validated at runtime via familyInstance.validateContractIR() */
  readonly contractIR: unknown;
  /**
   * Path to the contract file (for metadata in the result).
   */
  readonly contractPath?: string;
  /**
   * Path to the config file (for metadata in the result).
   */
  readonly configPath?: string;
  /**
   * Database connection. If provided, sign will connect before executing.
   * If omitted, the client must already be connected.
   * The type is driver-specific (e.g., string URL for Postgres).
   */
  readonly connection?: unknown;
  /** Optional progress callback for observing operation progress */
  readonly onProgress?: OnControlProgress;
}

/**
 * Options for the dbInit operation.
 */
export interface DbInitOptions {
  /** Contract IR or unvalidated JSON - validated at runtime via familyInstance.validateContractIR() */
  readonly contractIR: unknown;
  /**
   * Mode for the dbInit operation.
   * - 'plan': Returns planned operations without applying
   * - 'apply': Applies operations and writes marker
   */
  readonly mode: 'plan' | 'apply';
  /**
   * Database connection. If provided, dbInit will connect before executing.
   * If omitted, the client must already be connected.
   * The type is driver-specific (e.g., string URL for Postgres).
   */
  readonly connection?: unknown;
  /** Optional progress callback for observing operation progress */
  readonly onProgress?: OnControlProgress;
}

/**
 * Options for the dbUpdate operation.
 */
export interface DbUpdateOptions {
  /** Contract IR or unvalidated JSON - validated at runtime via familyInstance.validateContractIR() */
  readonly contractIR: unknown;
  /**
   * Mode for the dbUpdate operation.
   * - 'plan': Returns planned operations without applying
   * - 'apply': Applies operations and writes marker/ledger
   */
  readonly mode: 'plan' | 'apply';
  /**
   * Database connection. If provided, dbUpdate will connect before executing.
   * If omitted, the client must already be connected.
   * The type is driver-specific (e.g., string URL for Postgres).
   */
  readonly connection?: unknown;
  /**
   * When true, allows applying plans that contain destructive operations
   * (e.g., DROP TABLE, DROP COLUMN, ALTER TYPE).
   * When false (default), the operation returns a failure if the plan
   * includes destructive operations, prompting the user to use --plan
   * to preview and then re-run with --accept-data-loss.
   */
  readonly acceptDataLoss?: boolean;
  /** Optional progress callback for observing operation progress */
  readonly onProgress?: OnControlProgress;
}

/**
 * Options for the introspect operation.
 */
export interface IntrospectOptions {
  /**
   * Optional schema name to introspect.
   */
  readonly schema?: string;
  /**
   * Database connection. If provided, introspect will connect before executing.
   * If omitted, the client must already be connected.
   * The type is driver-specific (e.g., string URL for Postgres).
   */
  readonly connection?: unknown;
  /** Optional progress callback for observing operation progress */
  readonly onProgress?: OnControlProgress;
}

/**
 * Contract configuration for emit operation.
 */
export interface EmitContractConfig {
  /**
   * Contract source provider.
   */
  readonly sourceProvider: ContractSourceProvider;
  /**
   * Output path for contract.json.
   * The .d.ts types file will be colocated (e.g., contract.json → contract.d.ts).
   */
  readonly output: string;
}

/**
 * Options for the emit operation.
 */
export interface EmitOptions {
  /**
   * Contract configuration containing source, output, and types paths.
   */
  readonly contractConfig: EmitContractConfig;
  /** Optional progress callback for observing operation progress */
  readonly onProgress?: OnControlProgress;
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Successful dbInit result.
 */
export interface DbInitSuccess {
  readonly mode: 'plan' | 'apply';
  readonly plan: {
    readonly operations: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly operationClass: string;
    }>;
    readonly sql?: ReadonlyArray<string>;
  };
  readonly destination: {
    readonly storageHash: string;
    readonly profileHash?: string;
  };
  readonly execution?: {
    readonly operationsPlanned: number;
    readonly operationsExecuted: number;
  };
  readonly marker?: {
    readonly storageHash: string;
    readonly profileHash?: string;
  };
  readonly summary: string;
}

/**
 * Failure codes for dbInit operation.
 */
export type DbInitFailureCode = 'PLANNING_FAILED' | 'MARKER_ORIGIN_MISMATCH' | 'RUNNER_FAILED';

/**
 * Failure details for dbInit operation.
 */
export interface DbInitFailure {
  readonly code: DbInitFailureCode;
  readonly summary: string;
  readonly why: string | undefined;
  readonly conflicts: ReadonlyArray<MigrationPlannerConflict> | undefined;
  readonly meta: Record<string, unknown> | undefined;
  readonly marker?: {
    readonly storageHash?: string;
    readonly profileHash?: string;
  };
  readonly destination?: {
    readonly storageHash: string;
    readonly profileHash?: string | undefined;
  };
}

/**
 * Result type for dbInit operation.
 * Uses Result pattern: success returns DbInitSuccess, failure returns DbInitFailure.
 */
export type DbInitResult = Result<DbInitSuccess, DbInitFailure>;

/**
 * Successful dbUpdate result.
 */
export interface DbUpdateSuccess {
  readonly mode: 'plan' | 'apply';
  readonly plan: {
    readonly operations: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly operationClass: string;
    }>;
    readonly sql?: ReadonlyArray<string>;
  };
  readonly destination: {
    readonly storageHash: string;
    readonly profileHash?: string;
  };
  readonly execution?: {
    readonly operationsPlanned: number;
    readonly operationsExecuted: number;
  };
  readonly marker?: {
    readonly storageHash: string;
    readonly profileHash?: string;
  };
  readonly summary: string;
}

/**
 * Failure codes for dbUpdate operation.
 */
export type DbUpdateFailureCode = 'PLANNING_FAILED' | 'RUNNER_FAILED' | 'DESTRUCTIVE_CHANGES';

/**
 * Failure details for dbUpdate operation.
 */
export interface DbUpdateFailure {
  readonly code: DbUpdateFailureCode;
  readonly summary: string;
  readonly why: string | undefined;
  readonly conflicts: ReadonlyArray<MigrationPlannerConflict> | undefined;
  readonly meta: Record<string, unknown> | undefined;
}

/**
 * Result type for dbUpdate operation.
 * Uses Result pattern: success returns DbUpdateSuccess, failure returns DbUpdateFailure.
 */
export type DbUpdateResult = Result<DbUpdateSuccess, DbUpdateFailure>;

/**
 * Successful emit result.
 * Contains the hashes and paths of emitted files.
 */
export interface EmitSuccess {
  /** Storage hash of the emitted contract */
  readonly storageHash: string;
  /** Execution hash of the emitted contract (if execution section exists) */
  readonly executionHash?: string;
  /** Profile hash of the emitted contract (target-specific) */
  readonly profileHash: string;
  /** The emitted contract as JSON string */
  readonly contractJson: string;
  /** The emitted contract TypeScript declarations */
  readonly contractDts: string;
}

/**
 * Failure codes for emit operation.
 */
export type EmitFailureCode =
  | 'CONTRACT_SOURCE_INVALID'
  | 'CONTRACT_VALIDATION_FAILED'
  | 'EMIT_FAILED';

/**
 * Failure details for emit operation.
 */
export interface EmitFailure {
  readonly code: EmitFailureCode;
  readonly summary: string;
  readonly why: string | undefined;
  readonly meta: Record<string, unknown> | undefined;
  readonly diagnostics?: ContractSourceDiagnostics;
}

/**
 * Result type for emit operation.
 * Uses Result pattern: success returns EmitSuccess, failure returns EmitFailure.
 */
export type EmitResult = Result<EmitSuccess, EmitFailure>;

// ============================================================================
// Migration Apply Types
// ============================================================================

/**
 * A pre-planned migration edge ready for execution.
 * Contains the manifest metadata and the serialized operations from ops.json.
 */
export interface MigrationApplyEdge {
  readonly dirName: string;
  readonly from: string;
  readonly to: string;
  readonly toContract: unknown;
  readonly operations: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly operationClass: string;
    readonly [key: string]: unknown;
  }>;
}

/**
 * Options for the migrationApply operation.
 */
export interface MigrationApplyOptions {
  /**
   * Hash of the database state this apply path starts from.
   * This is resolved by the caller (typically the CLI orchestration layer).
   */
  readonly originHash: string;
  /**
   * Hash of the target contract this apply path must reach.
   * This is resolved by the caller (typically the CLI orchestration layer).
   */
  readonly destinationHash: string;
  /**
   * Ordered list of migration edges to execute from originHash to destinationHash.
   * The execution layer does not choose defaults; it only executes this explicit path.
   */
  readonly pendingEdges: readonly MigrationApplyEdge[];
  /**
   * Database connection. If provided, migrationApply will connect before executing.
   * If omitted, the client must already be connected.
   */
  readonly connection?: unknown;
  /** Optional progress callback for observing operation progress */
  readonly onProgress?: OnControlProgress;
}

/**
 * Record of a successfully applied migration.
 */
export interface MigrationApplyAppliedEntry {
  readonly dirName: string;
  readonly from: string;
  readonly to: string;
  readonly operationsExecuted: number;
}

/**
 * Successful migrationApply result.
 */
export interface MigrationApplySuccess {
  readonly migrationsApplied: number;
  readonly markerHash: string;
  readonly applied: readonly MigrationApplyAppliedEntry[];
  readonly summary: string;
}

/**
 * Failure codes for migrationApply operation.
 */
export type MigrationApplyFailureCode = 'RUNNER_FAILED' | 'EDGE_NOT_FOUND';

/**
 * Failure details for migrationApply operation.
 */
export interface MigrationApplyFailure {
  readonly code: MigrationApplyFailureCode;
  readonly summary: string;
  readonly why: string | undefined;
  readonly meta: Record<string, unknown> | undefined;
}

/**
 * Result type for migrationApply operation.
 */
export type MigrationApplyResult = Result<MigrationApplySuccess, MigrationApplyFailure>;

// ============================================================================
// Standalone Contract Emit Types
// ============================================================================

/**
 * Options for the standalone executeContractEmit function.
 * Used by tooling (e.g., Vite plugin) that needs to emit contracts
 * without the full ControlClient infrastructure.
 */
export interface ContractEmitOptions {
  /** Path to the prisma-next.config.ts file */
  readonly configPath: string;
  /** Optional AbortSignal for cancellation support */
  readonly signal?: AbortSignal;
}

/**
 * Result from the standalone executeContractEmit function.
 */
export interface ContractEmitResult {
  /** Hash of the storage contract (schema-level) */
  readonly storageHash: string;
  /** Hash of the execution contract (if execution section exists) */
  readonly executionHash?: string;
  /** Hash of the profile (target+extensions) */
  readonly profileHash: string;
  /** Paths to the emitted files */
  readonly files: {
    /** Path to the emitted contract.json file */
    readonly json: string;
    /** Path to the emitted contract.d.ts file */
    readonly dts: string;
  };
}

// ============================================================================
// Client Interface
// ============================================================================

/**
 * Programmatic control client for Prisma Next operations.
 *
 * Lifecycle: `connect(connection)` before operations, `close()` when done.
 * Both `init()` and `connect()` are auto-called by operations if needed,
 * but `connect()` requires a connection so must be called explicitly first
 * unless a default connection was provided in options.
 *
 * @see README.md "Programmatic Control API" section for usage examples
 */
export interface ControlClient {
  /**
   * Initializes the client by creating the control plane stack,
   * family instance, and validating framework components.
   *
   * Idempotent (safe to call multiple times).
   * Called automatically by `connect()` if not already initialized.
   */
  init(): void;

  /**
   * Establishes a database connection.
   * Auto-calls `init()` if not already initialized.
   * Must be called before any database operations unless a default connection
   * was provided in options.
   *
   * @param connection - Driver-specific connection input (e.g., URL string for Postgres).
   *   If omitted, uses the default connection from options (if provided).
   * @throws If connection fails, already connected, driver is not configured,
   *   or no connection provided and no default connection in options.
   */
  connect(connection?: unknown): Promise<void>;

  /**
   * Closes the database connection.
   * Idempotent (safe to call multiple times).
   * After close(), can call `connect()` again with same or different URL.
   */
  close(): Promise<void>;

  /**
   * Verifies database marker matches the contract.
   * Compares storageHash and profileHash.
   *
   * @returns Structured result (ok: false for mismatch, not throwing)
   * @throws If not connected or infrastructure failure
   */
  verify(options: VerifyOptions): Promise<VerifyDatabaseResult>;

  /**
   * Verifies database schema satisfies the contract requirements.
   *
   * @param options.strict - If true, extra tables/columns are issues. Default: false
   * @returns Structured result with schema issues
   * @throws If not connected or infrastructure failure
   */
  schemaVerify(options: SchemaVerifyOptions): Promise<VerifyDatabaseSchemaResult>;

  /**
   * Signs the database with a contract signature.
   * Writes or updates the signature if schema verification passes.
   * Idempotent (no-op if signature already matches).
   *
   * @returns Structured result
   * @throws If not connected or infrastructure failure
   */
  sign(options: SignOptions): Promise<SignDatabaseResult>;

  /**
   * Initializes database schema from contract.
   * Uses additive-only policy (no destructive changes).
   *
   * @param options.mode - 'plan' to preview, 'apply' to execute
   * @returns Result pattern: Ok with planned/executed operations, NotOk with failure details
   * @throws If not connected, target doesn't support migrations, or infrastructure failure
   */
  dbInit(options: DbInitOptions): Promise<DbInitResult>;

  /**
   * Updates a database schema to match the current contract.
   * Creates the signature table if it does not exist. No preconditions required.
   * Allows additive, widening, and destructive operation classes.
   *
   * @param options.mode - 'plan' to preview, 'apply' to execute
   * @returns Result pattern: Ok with planned/executed operations, NotOk with failure details
   * @throws If not connected, target doesn't support migrations, or infrastructure failure
   */
  dbUpdate(options: DbUpdateOptions): Promise<DbUpdateResult>;

  /**
   * Reads the contract marker from the database.
   * Returns null if no marker exists (fresh database).
   *
   * @throws If not connected or infrastructure failure
   */
  readMarker(): Promise<ContractMarkerRecord | null>;

  /**
   * Applies pre-planned on-disk migrations to the database.
   * Each migration runs in its own transaction with full execution checks.
   * Resume-safe: re-running after failure picks up from the last applied migration.
   *
   * @param options.originHash - Explicit source hash for the apply path
   * @param options.destinationHash - Explicit destination hash for the apply path
   * @param options.pendingEdges - Ordered migration edges to execute
   * @returns Result pattern: Ok with applied details, NotOk with failure details
   * @throws If not connected, target doesn't support migrations, or infrastructure failure
   */
  migrationApply(options: MigrationApplyOptions): Promise<MigrationApplyResult>;

  /**
   * Introspects the database schema.
   *
   * @returns Raw schema IR
   * @throws If not connected or infrastructure failure
   */
  introspect(options?: IntrospectOptions): Promise<unknown>;

  /**
   * Converts a schema IR to a schema view for CLI tree rendering.
   * Delegates to the family instance's toSchemaView method.
   *
   * @param schemaIR - The schema IR from introspect()
   * @returns CoreSchemaView if the family supports it, undefined otherwise
   */
  toSchemaView(schemaIR: unknown): CoreSchemaView | undefined;

  /**
   * Emits the contract to JSON and TypeScript declarations.
   * This is an offline operation that does NOT require a database connection.
   * Uses `init()` to create the stack but does NOT call `connect()`.
   *
   * @returns Result pattern: Ok with emit details, NotOk with failure details
   */
  emit(options: EmitOptions): Promise<EmitResult>;
}
