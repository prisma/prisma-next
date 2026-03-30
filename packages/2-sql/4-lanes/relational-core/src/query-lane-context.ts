import type { OperationRegistry } from '@prisma-next/operations';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { CodecRegistry } from './ast/codec-types';
import type { QueryOperationRegistry } from './query-operation-registry';

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
export interface ExecutionContext<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
> {
  readonly contract: TContract;
  readonly operations: OperationRegistry;
  readonly codecs: CodecRegistry;
  readonly queryOperations: QueryOperationRegistry;
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
