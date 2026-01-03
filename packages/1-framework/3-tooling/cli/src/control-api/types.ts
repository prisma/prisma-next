import type { ContractIR } from '@prisma-next/contract/ir';
import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
  ControlFamilyInstance,
  ControlTargetDescriptor,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';

// Re-export result types for consumer convenience
export type {
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';

// ============================================================================
// Client Options
// ============================================================================

/**
 * Options for creating a control client.
 * Framework components are provided at creation time.
 *
 * Note: This is NOT the same as CLI config. There's no `contract` field,
 * no file paths. The client is config-agnostic.
 */
export interface ControlClientOptions {
  readonly family: ControlFamilyDescriptor<string, ControlFamilyInstance<string>>;
  readonly target: ControlTargetDescriptor<string, string>;
  readonly adapter: ControlAdapterDescriptor<string, string>;
  readonly driver: ControlDriverDescriptor<string, string>;
  readonly extensionPacks?: ReadonlyArray<ControlExtensionDescriptor<string, string>>;
}

// ============================================================================
// Operation Options
// ============================================================================

/**
 * Options for the verify operation.
 */
export interface VerifyOptions {
  readonly contractIR: ContractIR;
}

/**
 * Options for the schemaVerify operation.
 */
export interface SchemaVerifyOptions {
  readonly contractIR: ContractIR;
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
  readonly contractIR: ContractIR;
}

/**
 * Options for the dbInit operation.
 */
export interface DbInitOptions {
  readonly contractIR: ContractIR;
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
 * Result type for dbInit operation.
 * Matches the CLI's DbInitResult but without file-path metadata.
 */
export interface DbInitResult {
  readonly ok: boolean;
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

// ============================================================================
// Client Interface
// ============================================================================

/**
 * Programmatic control client for Prisma Next operations.
 *
 * Usage:
 * ```typescript
 * const client = createPrismaNextControlClient({
 *   family: sql,
 *   target: postgres,
 *   adapter: postgresAdapter,
 *   driver: postgresDriver,
 *   extensionPacks: [],
 * });
 *
 * try {
 *   await client.connect(databaseUrl);
 *   const result = await client.verify({ contractIR });
 *   // ...
 * } finally {
 *   await client.close();
 * }
 * ```
 */
export interface PrismaNextControlClient {
  /**
   * Establishes a database connection.
   * Must be called before any database operations.
   *
   * @param url - Database connection string
   * @throws If connection fails or already connected
   */
  connect(url: string): Promise<void>;

  /**
   * Closes the database connection and cleans up resources.
   * Idempotent (safe to call multiple times).
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
   * @returns Structured result with planned/executed operations
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

/**
 * Internal interface for accessing client internals (for testing).
 * Not part of public API.
 */
export interface PrismaNextControlClientInternals {
  readonly driver: ControlDriverInstance<string, string> | null;
  readonly familyInstance: ControlFamilyInstance<string> | null;
  readonly options: ControlClientOptions;
}
