import type { ContractMarkerRecord, TargetFamilyHook } from '@prisma-next/contract/types';
import type { OperationSignature } from '@prisma-next/operations';
import type { ExtensionPackManifest, OperationManifest } from './pack-manifest-types';

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
 * Provides the family hook and assembly helpers.
 */
export interface FamilyDescriptor {
  readonly kind: 'family';
  readonly id: string;
  readonly hook: TargetFamilyHook;
  /**
   * Family-specific verification helpers for DB-connected commands.
   * Must remain in the migration/tooling plane (no runtime imports).
   */
  readonly verify?: {
    /**
     * Reads the contract marker from the database using the provided driver.
     * Returns the parsed marker record or null if no marker is found.
     * This abstracts SQL-specific details from the Control Plane.
     */
    readMarker: (driver: ControlPlaneDriver) => Promise<ContractMarkerRecord | null>;
    /**
     * Optionally collects supported codec typeIds from adapter/extension manifests
     * to enable coverage checks.
     */
    collectSupportedCodecTypeIds?: (
      descriptors: ReadonlyArray<TargetDescriptor | AdapterDescriptor | ExtensionDescriptor>,
    ) => readonly string[];
    /**
     * Introspects the database schema and returns a target-agnostic Schema IR.
     * Delegates to target-specific implementations (e.g., Postgres adapter) for concrete introspection.
     * This is used by schema verification and future migration planning.
     */
    introspectSchema?: (options: {
      readonly driver: ControlPlaneDriver;
      readonly contractIR?: unknown;
      readonly target: TargetDescriptor;
      readonly adapter: AdapterDescriptor;
      readonly extensions: ReadonlyArray<ExtensionDescriptor>;
    }) => Promise<unknown>;
    /**
     * Verifies that the live database schema satisfies the emitted contract.
     * Performs catalog introspection and comparison, returning schema issues if any.
     * This is used by `db schema-verify` command.
     */
    verifySchema?: (options: {
      readonly driver: ControlPlaneDriver;
      readonly contractIR: unknown;
      readonly target: TargetDescriptor;
      readonly adapter: AdapterDescriptor;
      readonly extensions: ReadonlyArray<ExtensionDescriptor>;
      readonly strict: boolean;
      readonly startTime: number;
      readonly contractPath: string;
      readonly configPath?: string;
    }) => Promise<{
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
        readonly issues: ReadonlyArray<{
          readonly kind: string;
          readonly table: string;
          readonly column?: string;
          readonly indexOrConstraint?: string;
          readonly expected?: string;
          readonly actual?: string;
          readonly message: string;
        }>;
      };
      readonly meta?: {
        readonly configPath?: string;
        readonly contractPath: string;
        readonly strict: boolean;
      };
      readonly timings: {
        readonly total: number;
      };
    }>;
  };
  /**
   * Converts an OperationManifest to an OperationSignature.
   * Family-specific conversion logic (e.g., SQL adds lowering spec).
   */
  readonly convertOperationManifest: (manifest: OperationManifest) => OperationSignature;
  /**
   * Validates a contract JSON and returns a validated ContractIR (without mappings).
   * Mappings are runtime-only and should not be part of ContractIR.
   */
  readonly validateContractIR: (contractJson: unknown) => unknown;
  /**
   * Optionally strips mappings from a contract.
   * Default implementation is a no-op (returns contract as-is).
   * SQL family overrides this to strip mappings before emitting ContractIR.
   */
  readonly stripMappings?: (contract: unknown) => unknown;
}

/**
 * Descriptor for a target pack (e.g., Postgres target).
 */
export interface TargetDescriptor {
  readonly kind: 'target';
  readonly id: string;
  readonly family: string;
  readonly manifest: ExtensionPackManifest;
}

/**
 * Descriptor for an adapter pack (e.g., Postgres adapter).
 * May optionally provide a runtime factory for DB-connected commands.
 */
export interface AdapterDescriptor {
  readonly kind: 'adapter';
  readonly id: string;
  readonly family: string;
  readonly manifest: ExtensionPackManifest;
  readonly create?: (...args: unknown[]) => unknown;
  readonly adapter?: unknown;
}

/**
 * Schema issue reported by extension verification hooks.
 */
export interface ExtensionSchemaIssue {
  readonly kind: string;
  readonly message: string;
  readonly table?: string;
  readonly column?: string;
  readonly detail?: Record<string, unknown>;
}

/**
 * Options passed to extension verifySchema hooks.
 */
export interface ExtensionSchemaVerifierOptions {
  readonly driver: ControlPlaneDriver;
  readonly contractIR: unknown;
  readonly schemaIR: unknown;
  readonly strict: boolean;
}

/**
 * Descriptor for an extension pack (e.g., pgvector).
 */
export interface ExtensionDescriptor {
  readonly kind: 'extension';
  readonly id: string;
  readonly family: string;
  readonly manifest: ExtensionPackManifest;
  /**
   * Optional schema verification hook for extension-specific checks.
   * Extensions can use this to verify extension-specific invariants
   * (e.g., pgvector extension presence, vector column compatibility).
   */
  readonly verifySchema?: (
    options: ExtensionSchemaVerifierOptions,
  ) => Promise<readonly ExtensionSchemaIssue[]>;
}
