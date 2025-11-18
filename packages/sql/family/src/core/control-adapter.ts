import type { ControlPlaneDriver } from '@prisma-next/core-control-plane/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';

/**
 * SQL control adapter interface for control-plane operations.
 * Implemented by target-specific adapters (e.g., Postgres, MySQL).
 *
 * @template TTarget - The target ID (e.g., 'postgres', 'mysql')
 */
export interface SqlControlAdapter<TTarget extends string = string> {
  /**
   * The target ID this adapter implements.
   * Used for type tracking and runtime validation.
   */
  readonly target: TTarget;

  /**
   * Introspects a database schema and returns a raw SqlSchemaIR.
   *
   * This is a pure schema discovery operation that queries the database catalog
   * and returns the schema structure without type mapping or contract enrichment.
   * Type mapping and enrichment are handled separately by enrichment helpers.
   *
   * @param driver - ControlPlaneDriver instance for executing queries (target-specific)
   * @param contractIR - Optional contract IR for contract-guided introspection (filtering, optimization)
   * @param schema - Schema name to introspect (defaults to 'public')
   * @returns Promise resolving to SqlSchemaIR representing the live database schema
   */
  introspect(
    driver: ControlPlaneDriver,
    contractIR?: unknown,
    schema?: string,
  ): Promise<SqlSchemaIR>;
}

/**
 * SQL control adapter descriptor interface.
 * Provides a factory method to create control adapter instances.
 *
 * @template TTarget - The target ID (e.g., 'postgres', 'mysql')
 */
export interface SqlControlAdapterDescriptor<TTarget extends string = string> {
  /**
   * Creates a SQL control adapter instance for control-plane operations.
   */
  create(): SqlControlAdapter<TTarget>;
}
