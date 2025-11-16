import type { ContractMarkerRecord, TargetFamilyHook } from '@prisma-next/contract/types';
import type { OperationSignature } from '@prisma-next/operations';
import type { ExtensionPackManifest, OperationManifest } from './pack-manifest-types';

/**
 * Control-plane context that binds together schema IR and family-specific control-plane registries/state.
 * This abstraction allows domain actions to work with family-specific types without understanding their concrete structure.
 *
 * The base type contains only the schema IR, which is common to all families.
 * Families extend this with their own control-plane state (e.g., SQL adds codecRegistry):
 * - SQL: `SqlFamilyContext = TargetFamilyContext<SqlSchemaIR> & { readonly codecRegistry: SqlCodecRegistry }`
 * - Other families can define their own context types as needed
 */
export interface TargetFamilyContext<TSchemaIR = unknown> {
  readonly schemaIR: TSchemaIR;
}

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
export interface FamilyDescriptor<TCtx extends TargetFamilyContext = TargetFamilyContext> {
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
      descriptors: ReadonlyArray<
        TargetDescriptor<TCtx> | AdapterDescriptor<TCtx> | ExtensionDescriptor<TCtx>
      >,
    ) => readonly string[];
    /**
     * Introspects the database schema and returns a target-agnostic Schema IR.
     * Delegates to target-specific implementations (e.g., Postgres adapter) for concrete introspection.
     * This is used by schema verification and future migration planning.
     * The contextInput contains family-specific control-plane state (e.g., codecRegistry for SQL).
     */
    introspectSchema?: (options: {
      readonly driver: ControlPlaneDriver;
      readonly contextInput: Omit<TCtx, 'schemaIR'>;
      readonly contractIR?: unknown;
      readonly target: TargetDescriptor<TCtx>;
      readonly adapter: AdapterDescriptor<TCtx>;
      readonly extensions: ReadonlyArray<ExtensionDescriptor<TCtx>>;
    }) => Promise<TCtx['schemaIR']>;
    /**
     * Verifies that the schema IR matches the contract IR.
     * Compares contract against schema IR and returns schema issues if any.
     * This is a low-level hook that performs comparison only; domain actions handle orchestration.
     * Extension verifySchema hooks are called by the domain action, not by this hook.
     */
    verifySchema?: (options: {
      readonly contractIR: unknown;
      readonly schemaIR: TCtx['schemaIR'];
      readonly target: TargetDescriptor<TCtx>;
      readonly adapter: AdapterDescriptor<TCtx>;
      readonly extensions: ReadonlyArray<ExtensionDescriptor<TCtx>>;
    }) => Promise<{ readonly issues: readonly SchemaIssue[] }>;
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
 * @template TCtx - The family context type for type consistency across descriptors.
 */
export interface TargetDescriptor<TCtx extends TargetFamilyContext = TargetFamilyContext> {
  readonly kind: 'target';
  readonly id: string;
  readonly family: string;
  readonly manifest: ExtensionPackManifest;
  // TCtx is used for type consistency across descriptors, even if not used in the interface body
  readonly _contextType?: TCtx;
}

/**
 * Descriptor for an adapter pack (e.g., Postgres adapter).
 * May optionally provide a runtime factory for DB-connected commands.
 * @template TCtx - The family context type for type consistency across descriptors.
 */
export interface AdapterDescriptor<TCtx extends TargetFamilyContext = TargetFamilyContext> {
  readonly kind: 'adapter';
  readonly id: string;
  readonly family: string;
  readonly manifest: ExtensionPackManifest;
  readonly create?: (...args: unknown[]) => unknown;
  readonly adapter?: unknown;
  // TCtx is used for type consistency across descriptors, even if not used in the interface body
  readonly _contextType?: TCtx;
}

/**
 * Schema issue reported during schema verification.
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
 * @template TCtx - The family context type for type consistency across descriptors.
 */
export interface ExtensionDescriptor<TCtx extends TargetFamilyContext = TargetFamilyContext> {
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
  // TCtx is used for type consistency across descriptors, even if not used in the interface body
  readonly _contextType?: TCtx;
}
