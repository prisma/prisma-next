import type { Contract } from '@prisma-next/contract/types';
import type { CodecDescriptor } from '@prisma-next/framework-components/codec';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlOperationRegistry } from '@prisma-next/sql-operations';
import type { CodecRegistry, ContractCodecRegistry } from './ast/codec-types';

/**
 * Codec-id-keyed accessor for descriptor metadata. The unified read API
 * for codec-id-keyed metadata (`traits`, `targetTypes`, `meta`) — non-
 * branching for parameterized vs. non-parameterized codecs since every
 * codec ships as (or is synthesized into) a `CodecDescriptor`.
 *
 * See codec-registry-unification spec § Decision and AC-3.
 */
export interface CodecDescriptorRegistry {
  /**
   * Descriptors carry distinct param shapes per codec id; the registry is
   * heterogeneous and the consumer narrows per codec.
   */
  descriptorFor(codecId: string): CodecDescriptor<unknown> | undefined;
  /**
   * All registered descriptors. Used by `validateCodecRegistryCompleteness`
   * and other startup-time consumers that enumerate descriptors.
   */
  values(): IterableIterator<CodecDescriptor<unknown>>;
  /**
   * Descriptors indexed by `targetTypes[i]` (each scalar type the codec
   * advertises). Multiple descriptors may map to the same scalar type;
   * ordering reflects registration order.
   */
  byTargetType(targetType: string): readonly CodecDescriptor<unknown>[];
}

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
   * codec instances; also used as the codec-id-only fallback at the
   * `forCodecId` boundary while AC-5's `ParamRef.refs` plumbing remains
   * deferred (TML-2357).
   */
  readonly codecs: CodecRegistry;
  /**
   * Contract-bound codec registry built once at context-construction time
   * by walking the contract's columns and resolving each to its per-
   * instance codec (parameterized columns) or the shared codec from the
   * legacy registry (non-parameterized columns). The dispatch path
   * (`encodeParam` / `decodeRow`) consults `forColumn(table, column)`
   * when the call site has the ref, falling back to `forCodecId(codecId)`
   * otherwise. Codec-registry-unification spec § AC-4.
   */
  readonly contractCodecs: ContractCodecRegistry;
  /**
   * Codec-id-keyed descriptor map. Single source of truth for codec-id-
   * keyed metadata (`traits`, `targetTypes`, `meta`) — every codec,
   * parameterized or not, resolves through this map without branching.
   * Codec-registry-unification spec § AC-3.
   */
  readonly codecDescriptors: CodecDescriptorRegistry;
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
