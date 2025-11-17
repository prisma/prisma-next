import type { ContractIR } from '@prisma-next/contract/ir';
import type { TargetFamilyHook } from '@prisma-next/contract/types';
import type { ExtensionPackManifest } from './pack-manifest-types';
import type { CoreSchemaView } from './schema-view';

/**
 * Minimal driver interface for Control Plane database operations.
 * Provides query execution and connection management.
 */
export interface ControlPlaneDriver {
  /**
   * Executes a SQL query with optional parameters.
   * @returns Promise resolving to query results with rows array
   */
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }>;
  /**
   * Closes the database connection.
   */
  close(): Promise<void>;
}

/**
 * Descriptor for a driver pack (e.g., Postgres driver).
 */
export interface DriverDescriptor {
  readonly kind: 'driver';
  readonly id: string;
  readonly family: string;
  readonly manifest: ExtensionPackManifest;
  /**
   * Creates a ControlPlaneDriver instance from a connection URL.
   * @param url - Database connection URL
   * @returns Promise resolving to a ControlPlaneDriver instance
   */
  create(url: string): Promise<ControlPlaneDriver>;
}

/**
 * Descriptor for a target family (e.g., SQL).
 * Provides the family hook and factory method.
 */
export interface FamilyDescriptor<TFamilyId extends string, TFamilyInstance = unknown> {
  readonly kind: 'family';
  readonly familyId: TFamilyId;
  readonly manifest: ExtensionPackManifest;
  readonly hook: TargetFamilyHook;
  /**
   * Creates a family instance for control-plane operations.
   * @param options - Target, adapter, and extensions for the instance
   * @returns Family instance that implements domain actions
   */
  create(options: {
    readonly target: TargetDescriptor<TFamilyId>;
    readonly adapter: AdapterDescriptor<TFamilyId>;
    readonly extensions: ReadonlyArray<ExtensionDescriptor<TFamilyId>>;
  }): TFamilyInstance;
}

/**
 * Descriptor for a target pack (e.g., Postgres target).
 */
export interface TargetDescriptor<TFamilyId extends string> {
  readonly kind: 'target';
  readonly familyId: TFamilyId;
  readonly id: string;
  readonly manifest: ExtensionPackManifest;
}

/**
 * Descriptor for an adapter pack (e.g., Postgres adapter).
 * May optionally provide a runtime factory for DB-connected commands.
 */
export interface AdapterDescriptor<TFamilyId extends string> {
  readonly kind: 'adapter';
  readonly familyId: TFamilyId;
  readonly id: string;
  readonly manifest: ExtensionPackManifest;
  readonly create?: (...args: unknown[]) => unknown;
  readonly adapter?: unknown;
  readonly createControlInstance?: () => unknown;
}

/**
 * Descriptor for an extension pack (e.g., pgvector).
 */
export interface ExtensionDescriptor<TFamilyId extends string> {
  readonly kind: 'extension';
  readonly familyId: TFamilyId;
  readonly id: string;
  readonly manifest: ExtensionPackManifest;
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
    readonly driver: ControlPlaneDriver;
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
    readonly driver: ControlPlaneDriver;
    readonly contractIR: unknown;
    readonly strict: boolean;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<TSchemaVerifyResult>;

  /**
   * Introspects the database schema and returns a family-specific schema IR.
   */
  introspect(options: {
    readonly driver: ControlPlaneDriver;
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
  };
  readonly meta?: {
    readonly configPath?: string;
    readonly contractPath: string;
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
