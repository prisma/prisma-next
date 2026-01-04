import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
  ControlFamilyInstance,
  ControlTargetDescriptor,
  MigrationPlannerConflict,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import type { Result } from '@prisma-next/utils/result';

// Re-export result types for consumer convenience
export type {
  ControlPlaneStack,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';

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
// Operation Options
// ============================================================================

/**
 * Options for the verify operation.
 */
export interface VerifyOptions {
  /** Contract IR or unvalidated JSON - validated at runtime via familyInstance.validateContractIR() */
  readonly contractIR: unknown;
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
}

/**
 * Options for the sign operation.
 */
export interface SignOptions {
  /** Contract IR or unvalidated JSON - validated at runtime via familyInstance.validateContractIR() */
  readonly contractIR: unknown;
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
}

/**
 * Options for the introspect operation.
 */
export interface IntrospectOptions {
  /**
   * Optional schema name to introspect.
   */
  readonly schema?: string;
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
  };
  readonly execution?: {
    readonly operationsPlanned: number;
    readonly operationsExecuted: number;
  };
  readonly marker?: {
    readonly coreHash: string;
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
  readonly conflicts?: ReadonlyArray<MigrationPlannerConflict>;
  readonly marker?: {
    readonly coreHash?: string;
    readonly profileHash?: string;
  };
  readonly destination?: {
    readonly coreHash: string;
    readonly profileHash?: string | undefined;
  };
}

/**
 * Result type for dbInit operation.
 * Uses Result pattern: success returns DbInitSuccess, failure returns DbInitFailure.
 */
export type DbInitResult = Result<DbInitSuccess, DbInitFailure>;

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Internal connected state for the control client.
 * Used by the client implementation to track connection state.
 */
export interface ConnectedState<TFamilyId extends string, TTargetId extends string> {
  readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
  readonly familyInstance: ControlFamilyInstance<TFamilyId>;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
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
   * Compares coreHash and profileHash.
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
   * Signs the database with a contract marker.
   * Writes or updates the contract marker if schema verification passes.
   * Idempotent (no-op if marker already matches).
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
   * Introspects the database schema.
   *
   * @returns Raw schema IR
   * @throws If not connected or infrastructure failure
   */
  introspect(options?: IntrospectOptions): Promise<unknown>;
}
