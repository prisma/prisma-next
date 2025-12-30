import type { ContractIR } from '@prisma-next/contract/ir';
import type { ExtensionPackManifest } from '@prisma-next/contract/pack-manifest-types';
import type { TargetFamilyHook } from '@prisma-next/contract/types';
import type { TargetMigrationsCapability } from './migrations';
import type { CoreSchemaView } from './schema-view';

// Re-export migration types for convenience
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
  MigrationRunnerFailure,
  MigrationRunnerResult,
  MigrationRunnerSuccessValue,
  TargetMigrationsCapability,
} from './migrations';

// ============================================================================
// Control*Instance Base Interfaces (ADR 151)
// ============================================================================

/**
 * Base interface for control-plane family instances.
 * Families extend this with domain-specific methods.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 */
export interface ControlFamilyInstance<TFamilyId extends string = string> {
  readonly familyId: TFamilyId;
}

/**
 * Base interface for control-plane target instances.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export interface ControlTargetInstance<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
}

/**
 * Base interface for control-plane adapter instances.
 * Families extend this with family-specific adapter interfaces.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export interface ControlAdapterInstance<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
}

/**
 * Base interface for control-plane driver instances.
 * Replaces ControlPlaneDriver with plane-first naming.
 *
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export interface ControlDriverInstance<TTargetId extends string = string> {
  readonly targetId?: TTargetId;
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }>;
  close(): Promise<void>;
}

/**
 * Base interface for control-plane extension instances.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export interface ControlExtensionInstance<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
}

/**
 * Operation context for propagating metadata through control-plane operation call chains.
 * Inspired by OpenTelemetry's Context and Sentry's Scope patterns.
 *
 * This context carries informational metadata (like file paths) that can be used for
 * error reporting, logging, and debugging, but is not required for structural correctness.
 * It allows subsystems to propagate context without coupling to file I/O concerns.
 *
 * @example
 * ```typescript
 * const context: OperationContext = {
 *   contractPath: './contract.json',
 *   configPath: './prisma-next.config.ts',
 * };
 *
 * await runner.execute({ plan, driver, destinationContract: contract, context });
 * ```
 */
export interface OperationContext {
  /**
   * Path to the contract file (if applicable).
   * Used for error reporting and metadata, not for file I/O.
   */
  readonly contractPath?: string;

  /**
   * Path to the configuration file (if applicable).
   * Used for error reporting and metadata, not for file I/O.
   */
  readonly configPath?: string;

  /**
   * Additional metadata that can be propagated through the call chain.
   * Extensible for future needs without breaking changes.
   */
  readonly meta?: Readonly<Record<string, unknown>>;
}

// ============================================================================
// Control*Descriptor Interfaces (ADR 151)
// ============================================================================

/**
 * Descriptor for a control-plane family (e.g., SQL).
 * Provides the family hook and factory method.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TFamilyInstance - The family instance type
 */
export interface ControlFamilyDescriptor<
  TFamilyId extends string,
  TFamilyInstance extends ControlFamilyInstance<TFamilyId> = ControlFamilyInstance<TFamilyId>,
> {
  readonly kind: 'family';
  readonly id: string;
  readonly familyId: TFamilyId;
  readonly manifest: ExtensionPackManifest;
  readonly hook: TargetFamilyHook;
  create<TTargetId extends string>(options: {
    readonly target: ControlTargetDescriptor<TFamilyId, TTargetId>;
    readonly adapter: ControlAdapterDescriptor<TFamilyId, TTargetId>;
    readonly driver: ControlDriverDescriptor<TFamilyId, TTargetId>;
    readonly extensions: readonly ControlExtensionDescriptor<TFamilyId, TTargetId>[];
  }): TFamilyInstance;
}

/**
 * Descriptor for a control-plane target pack (e.g., Postgres target).
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 * @template TTargetInstance - The target instance type
 */
export interface ControlTargetDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TTargetInstance extends ControlTargetInstance<TFamilyId, TTargetId> = ControlTargetInstance<
    TFamilyId,
    TTargetId
  >,
> {
  readonly kind: 'target';
  readonly id: string;
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
  readonly manifest: ExtensionPackManifest;
  /**
   * Optional migrations capability.
   * Targets that support migrations expose this property.
   */
  readonly migrations?: TargetMigrationsCapability<TFamilyId>;
  create(): TTargetInstance;
}

/**
 * Descriptor for a control-plane adapter pack (e.g., Postgres adapter).
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 * @template TAdapterInstance - The adapter instance type
 */
export interface ControlAdapterDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TAdapterInstance extends ControlAdapterInstance<TFamilyId, TTargetId> = ControlAdapterInstance<
    TFamilyId,
    TTargetId
  >,
> {
  readonly kind: 'adapter';
  readonly id: string;
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
  readonly manifest: ExtensionPackManifest;
  create(): TAdapterInstance;
}

/**
 * Descriptor for a control-plane driver pack (e.g., Postgres driver).
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 * @template TDriverInstance - The driver instance type
 */
export interface ControlDriverDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TDriverInstance extends ControlDriverInstance<TTargetId> = ControlDriverInstance<TTargetId>,
> {
  readonly kind: 'driver';
  readonly id: string;
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
  readonly manifest: ExtensionPackManifest;
  create(url: string): Promise<TDriverInstance>;
}

/**
 * Descriptor for a control-plane extension pack (e.g., pgvector).
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 * @template TExtensionInstance - The extension instance type
 */
export interface ControlExtensionDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TExtensionInstance extends ControlExtensionInstance<
    TFamilyId,
    TTargetId
  > = ControlExtensionInstance<TFamilyId, TTargetId>,
> {
  readonly kind: 'extension';
  readonly id: string;
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
  readonly manifest: ExtensionPackManifest;
  create(): TExtensionInstance;
}

/**
 * Family instance interface for control-plane domain actions.
 * Each family implements this interface with family-specific types.
 */
export interface FamilyInstance<
  TFamilyId extends string,
  TSchemaIR = unknown,
  TVerifyResult = unknown,
  TSchemaVerifyResult = unknown,
  TSignResult = unknown,
> {
  readonly familyId: TFamilyId;

  /**
   * Validates a contract JSON and returns a validated ContractIR (without mappings).
   * Mappings are runtime-only and should not be part of ContractIR.
   */
  validateContractIR(contractJson: unknown): unknown;

  /**
   * Verifies the database marker against the contract.
   * Compares target, coreHash, and profileHash.
   */
  verify(options: {
    readonly driver: ControlDriverInstance;
    readonly contractIR: unknown;
    readonly expectedTargetId: string;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<TVerifyResult>;

  /**
   * Verifies the database schema against the contract.
   * Compares contract requirements against live database schema.
   */
  schemaVerify(options: {
    readonly driver: ControlDriverInstance;
    readonly contractIR: unknown;
    readonly strict: boolean;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<TSchemaVerifyResult>;

  /**
   * Signs the database with the contract marker.
   * Writes or updates the contract marker if schema verification passes.
   * This operation is idempotent - if the marker already matches, no changes are made.
   */
  sign(options: {
    readonly driver: ControlDriverInstance;
    readonly contractIR: unknown;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<TSignResult>;

  /**
   * Introspects the database schema and returns a family-specific schema IR.
   *
   * This is a read-only operation that returns a snapshot of the live database schema.
   * The method is family-owned and delegates to target/adapter-specific introspectors
   * to perform the actual schema introspection.
   *
   * @param options - Introspection options
   * @param options.driver - Control plane driver for database connection
   * @param options.contractIR - Optional contract IR for contract-guided introspection.
   *   When provided, families may use it for filtering, optimization, or validation
   *   during introspection. The contract IR does not change the meaning of "what exists"
   *   in the database - it only guides how introspection is performed.
   * @returns Promise resolving to the family-specific Schema IR (e.g., `SqlSchemaIR` for SQL).
   *   The IR represents the complete schema snapshot at the time of introspection.
   */
  introspect(options: {
    readonly driver: ControlDriverInstance;
    readonly contractIR?: unknown;
  }): Promise<TSchemaIR>;

  /**
   * Optionally projects a family-specific Schema IR into a core schema view.
   * Families that provide this method enable rich tree output for CLI visualization.
   * Families that do not provide it still support introspection via raw Schema IR.
   */
  toSchemaView?(schema: TSchemaIR): CoreSchemaView;

  /**
   * Emits contract JSON and DTS as strings.
   * Uses the instance's preassembled state (operation registry, type imports, extension IDs).
   * Handles stripping mappings and validation internally.
   */
  emitContract(options: { readonly contractIR: ContractIR | unknown }): Promise<EmitContractResult>;
}

/**
 * Result type for database marker verification operations.
 */
export interface VerifyDatabaseResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly summary: string;
  readonly contract: {
    readonly coreHash: string;
    readonly profileHash?: string;
  };
  readonly marker?: {
    readonly coreHash?: string;
    readonly profileHash?: string;
  };
  readonly target: {
    readonly expected: string;
    readonly actual?: string;
  };
  readonly missingCodecs?: readonly string[];
  readonly codecCoverageSkipped?: boolean;
  readonly meta?: {
    readonly configPath?: string;
    readonly contractPath: string;
  };
  readonly timings: {
    readonly total: number;
  };
}

/**
 * Schema issue type for schema verification results.
 */
export interface SchemaIssue {
  readonly kind:
    | 'missing_table'
    | 'missing_column'
    | 'extra_table'
    | 'extra_column'
    | 'extra_primary_key'
    | 'extra_foreign_key'
    | 'extra_unique_constraint'
    | 'extra_index'
    | 'type_mismatch'
    | 'nullability_mismatch'
    | 'primary_key_mismatch'
    | 'foreign_key_mismatch'
    | 'unique_constraint_mismatch'
    | 'index_mismatch'
    | 'extension_missing';
  readonly table: string;
  readonly column?: string;
  readonly indexOrConstraint?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly message: string;
}

/**
 * Contract-shaped verification tree node for schema verification results.
 * Family-agnostic structure that follows the contract structure.
 */
export interface SchemaVerificationNode {
  readonly status: 'pass' | 'warn' | 'fail';
  readonly kind: string;
  readonly name: string;
  readonly contractPath: string;
  readonly code: string;
  readonly message: string;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly children: readonly SchemaVerificationNode[];
}

/**
 * Result type for database schema verification operations.
 */
export interface VerifyDatabaseSchemaResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly summary: string;
  readonly contract: {
    readonly coreHash: string;
    readonly profileHash?: string;
  };
  readonly target: {
    readonly expected: string;
    readonly actual?: string;
  };
  readonly schema: {
    readonly issues: readonly SchemaIssue[];
    readonly root: SchemaVerificationNode;
    readonly counts: {
      readonly pass: number;
      readonly warn: number;
      readonly fail: number;
      readonly totalNodes: number;
    };
  };
  readonly meta?: {
    readonly configPath?: string;
    readonly contractPath?: string;
    readonly strict: boolean;
  };
  readonly timings: {
    readonly total: number;
  };
}

/**
 * Result type for contract emission operations.
 */
export interface EmitContractResult {
  readonly contractJson: string;
  readonly contractDts: string;
  readonly coreHash: string;
  readonly profileHash: string;
}

/**
 * Result envelope for schema introspection operations.
 * Used by CLI for JSON output when introspecting database schemas.
 *
 * @template TSchemaIR - The family-specific Schema IR type (e.g., `SqlSchemaIR` for SQL)
 */
export interface IntrospectSchemaResult<TSchemaIR = unknown> {
  readonly ok: true;
  readonly summary: string;
  readonly target: {
    readonly familyId: string;
    readonly id: string;
  };
  readonly schema: TSchemaIR;
  readonly meta?: {
    readonly configPath?: string;
    readonly dbUrl?: string;
  };
  readonly timings: {
    readonly total: number;
  };
}

/**
 * Result type for database signing operations.
 * Returned when writing or updating the contract marker in the database.
 */
export interface SignDatabaseResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly contract: {
    readonly coreHash: string;
    readonly profileHash?: string;
  };
  readonly target: {
    readonly expected: string;
    readonly actual?: string;
  };
  readonly marker: {
    readonly created: boolean;
    readonly updated: boolean;
    readonly previous?: {
      readonly coreHash?: string;
      readonly profileHash?: string;
    };
  };
  readonly meta?: {
    readonly configPath?: string;
    readonly contractPath: string;
  };
  readonly timings: {
    readonly total: number;
  };
}
