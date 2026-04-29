import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlOperationRegistry } from '@prisma-next/sql-operations';
import type { CodecRegistry, ContractCodecRegistry } from './ast/codec-types';

/**
 * Registry of initialized type helpers from storage.types.
 * Each key is a type name from storage.types, and the value is:
 * - The result of the codec's init hook (if provided), or
 * - The full StorageTypeInstance metadata (codecId, nativeType, typeParams) if no init hook
 */
export type TypeHelperRegistry = Record<string, unknown>;

// =============================================================================
// JSON Schema Validation Types
// =============================================================================

/**
 * A single validation error from JSON Schema validation.
 */
export interface JsonSchemaValidationError {
  readonly path: string;
  readonly message: string;
  readonly keyword: string;
}

/**
 * Result of a JSON Schema validation.
 */
export type JsonSchemaValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: ReadonlyArray<JsonSchemaValidationError> };

/**
 * A compiled JSON Schema validate function.
 * Returns a structured result indicating whether the value conforms to the schema.
 */
export type JsonSchemaValidateFn = (value: unknown) => JsonSchemaValidationResult;

/**
 * Registry of compiled JSON Schema validators for columns with typed JSON/JSONB.
 *
 * Built during context creation by scanning the contract for columns whose codec
 * descriptor provides an `init` hook that returns a `{ validate }` helper.
 * Keys are `"table.column"` (e.g., `"user.metadata"`).
 */
export interface JsonSchemaValidatorRegistry {
  /** Get the compiled validator for a column. Key format: "table.column". */
  get(key: string): JsonSchemaValidateFn | undefined;
  /** Number of registered validators. */
  readonly size: number;
}

export type MutationDefaultsOp = 'create' | 'update';

export type AppliedMutationDefault = {
  readonly column: string;
  readonly value: unknown;
};

export type MutationDefaultsOptions = {
  readonly op: MutationDefaultsOp;
  readonly table: string;
  readonly values: Record<string, unknown>;
};

/**
 * Minimal context interface for SQL query lanes.
 *
 * Lanes only need contract, operations, and codecs to build typed ASTs and attach
 * operation builders. This interface explicitly excludes runtime concerns like
 * adapters, connection management, and transaction state.
 */
export interface ExecutionContext<TContract extends Contract<SqlStorage> = Contract<SqlStorage>> {
  readonly contract: TContract;
  /**
   * Codec registry indexed by codec id. Source of shared, non-parameterized
   * codec instances; also used by the SQL builder and ORM client for codec-
   * level metadata (traits, scalar mapping, iteration).
   */
  readonly codecs: CodecRegistry;
  /**
   * Contract-bound codec registry built once at context-construction time
   * by walking the contract's columns and resolving each to its per-instance
   * codec (parameterized columns) or the shared codec from the legacy
   * registry (non-parameterized columns). The dispatch path
   * (`encodeParam` / `decodeRow`) consults `forColumn(table, column)` when
   * the call site has the ref, falling back to `forCodecId(codecId)`
   * otherwise. See ADR 205 + Phase 3 of the codec-registry-unification
   * project.
   */
  readonly contractCodecs: ContractCodecRegistry;
  readonly queryOperations: SqlOperationRegistry;
  /**
   * Type helper registry for parameterized types.
   * Schema builders expose these helpers via schema.types.
   */
  readonly types: TypeHelperRegistry;
  /**
   * Compiled JSON Schema validators for typed JSON/JSONB columns.
   * Present only when the contract declares columns with JSON Schema typeParams.
   */
  readonly jsonSchemaValidators?: JsonSchemaValidatorRegistry;
  /**
   * Applies execution-time mutation defaults for the given table.
   * Returns the applied defaults (caller-provided values always win).
   */
  applyMutationDefaults(options: MutationDefaultsOptions): ReadonlyArray<AppliedMutationDefault>;
}
