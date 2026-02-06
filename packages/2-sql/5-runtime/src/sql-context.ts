import { checkContractComponentRequirements } from '@prisma-next/contract/framework-components';
import type {
  RuntimeAdapterDescriptor,
  RuntimeAdapterInstance,
  RuntimeDriverInstance,
  RuntimeExtensionDescriptor,
  RuntimeExtensionInstance,
  RuntimeTargetDescriptor,
  RuntimeTargetInstance,
} from '@prisma-next/core-execution-plane/types';
import { createOperationRegistry } from '@prisma-next/operations';
import { runtimeError } from '@prisma-next/runtime-executor';
import type { SqlContract, SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import type {
  Adapter,
  CodecRegistry,
  LoweredStatement,
  QueryAst,
  SqlDriver,
} from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  ExecutionContext,
  TypeHelperRegistry,
} from '@prisma-next/sql-relational-core/query-lane-context';
import type { Type } from 'arktype';
import { type as arktype } from 'arktype';

// ============================================================================
// Runtime Parameterized Codec Descriptor Types
// ============================================================================

/**
 * Runtime parameterized codec descriptor.
 * Provides validation schema and optional init hook for codecs that support type parameters.
 * Used at runtime to validate typeParams and create type helpers.
 */
export interface RuntimeParameterizedCodecDescriptor<
  TParams = Record<string, unknown>,
  THelper = unknown,
> {
  /** The codec ID this descriptor applies to (e.g., 'pg/vector@1') */
  readonly codecId: string;

  /**
   * Arktype schema for validating typeParams.
   * The schema is used to validate both storage.types entries and inline column typeParams.
   */
  readonly paramsSchema: Type<TParams>;

  /**
   * Optional init hook called during runtime context creation.
   * Receives validated params and returns a helper object to be stored in context.types.
   * If not provided, the validated params are stored directly.
   */
  readonly init?: (params: TParams) => THelper;
}

// ============================================================================
// SQL Static Contributions Interface
// ============================================================================

/**
 * Static contributions surface for SQL runtime-plane descriptors.
 *
 * This interface defines the methods that targets, adapters, and extensions
 * must implement to contribute codecs, operations, and parameterized codec
 * descriptors to the ExecutionContext.
 *
 * All methods are **required** (non-optional). If a descriptor has nothing
 * to contribute, it returns empty values. This design:
 * - Ensures consistent API across all descriptor types
 * - Eliminates null-checking and defaulting in context creation
 * - Makes contributions explicit and discoverable
 */
export interface SqlStaticContributions {
  /** Returns codecs to register in the runtime context. */
  readonly codecs: () => CodecRegistry;
  /** Returns operation signatures to register in the runtime context. */
  readonly operationSignatures: () => ReadonlyArray<SqlOperationSignature>;
  /**
   * Returns parameterized codec descriptors for type validation and helper creation.
   * Uses unknown for type parameters to allow any concrete descriptor types.
   */
  // biome-ignore lint/suspicious/noExplicitAny: needed for covariance with concrete descriptor types
  readonly parameterizedCodecs: () => ReadonlyArray<RuntimeParameterizedCodecDescriptor<any, any>>;
}

// ============================================================================
// SQL Runtime Descriptor Types (extend core types with static contributions)
// ============================================================================

/**
 * SQL runtime target descriptor.
 * Extends RuntimeTargetDescriptor with required static contributions.
 *
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 * @template TTargetInstance - The target instance type
 */
export interface SqlRuntimeTargetDescriptor<
  TTargetId extends string = string,
  TTargetInstance extends RuntimeTargetInstance<'sql', TTargetId> = RuntimeTargetInstance<
    'sql',
    TTargetId
  >,
> extends RuntimeTargetDescriptor<'sql', TTargetId, TTargetInstance>,
    SqlStaticContributions {}

/**
 * SQL runtime adapter descriptor.
 * Extends RuntimeAdapterDescriptor with required static contributions.
 *
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 * @template TAdapterInstance - The adapter instance type
 */
export interface SqlRuntimeAdapterDescriptor<
  TTargetId extends string = string,
  TAdapterInstance extends RuntimeAdapterInstance<'sql', TTargetId> = RuntimeAdapterInstance<
    'sql',
    TTargetId
  >,
> extends RuntimeAdapterDescriptor<'sql', TTargetId, TAdapterInstance>,
    SqlStaticContributions {}

/**
 * SQL runtime extension descriptor.
 * Extends RuntimeExtensionDescriptor with required static contributions.
 *
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 * @template TExtensionInstance - The extension instance type
 */
export interface SqlRuntimeExtensionDescriptor<TTargetId extends string = string>
  extends RuntimeExtensionDescriptor<'sql', TTargetId, SqlRuntimeExtensionInstance<TTargetId>>,
    SqlStaticContributions {
  create(): SqlRuntimeExtensionInstance<TTargetId>;
}

// ============================================================================
// SQL Execution Stack (descriptors-only)
// ============================================================================

/**
 * A descriptors-only SQL execution stack for static context creation.
 * All descriptors implement SqlStaticContributions, so context can be
 * derived without calling create() on any component.
 */
export interface SqlExecutionStack<TTargetId extends string = string> {
  readonly target: SqlRuntimeTargetDescriptor<TTargetId>;
  readonly adapter: SqlRuntimeAdapterDescriptor<TTargetId>;
  readonly extensionPacks: readonly SqlRuntimeExtensionDescriptor<TTargetId>[];
}

// ============================================================================
// SQL Runtime Extension Types
// ============================================================================

/**
 * SQL runtime extension instance.
 * Identity-only — contributions (codecs, operations, parameterized codecs)
 * live on the **descriptor**, not the instance.
 *
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export interface SqlRuntimeExtensionInstance<TTargetId extends string>
  extends RuntimeExtensionInstance<'sql', TTargetId> {}

// ============================================================================
// SQL Runtime Adapter Instance
// ============================================================================

/**
 * SQL runtime adapter instance interface.
 * Combines RuntimeAdapterInstance identity with SQL Adapter behavior.
 * The instance IS an Adapter (via intersection), not HAS an adapter property.
 *
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export type SqlRuntimeAdapterInstance<TTargetId extends string = string> = RuntimeAdapterInstance<
  'sql',
  TTargetId
> &
  Adapter<QueryAst, SqlContract<SqlStorage>, LoweredStatement>;

/**
 * SQL runtime driver instance type.
 * Combines identity properties with SQL driver behavior methods.
 */
export type SqlRuntimeDriverInstance<TTargetId extends string = string> = RuntimeDriverInstance<
  'sql',
  TTargetId
> &
  SqlDriver;

export type { ExecutionContext, TypeHelperRegistry };

export function assertExecutionStackContractRequirements(
  contract: SqlContract<SqlStorage>,
  stack: SqlExecutionStack,
): void {
  const providedComponentIds = new Set<string>([
    stack.target.id,
    stack.adapter.id,
    ...stack.extensionPacks.map((pack) => pack.id),
  ]);

  const result = checkContractComponentRequirements({
    contract,
    expectedTargetFamily: 'sql',
    expectedTargetId: stack.target.targetId,
    providedComponentIds,
  });

  if (result.familyMismatch) {
    throw runtimeError(
      'RUNTIME.CONTRACT_FAMILY_MISMATCH',
      `Contract target family '${result.familyMismatch.actual}' does not match runtime family '${result.familyMismatch.expected}'.`,
      {
        actual: result.familyMismatch.actual,
        expected: result.familyMismatch.expected,
      },
    );
  }

  if (result.targetMismatch) {
    throw runtimeError(
      'RUNTIME.CONTRACT_TARGET_MISMATCH',
      `Contract target '${result.targetMismatch.actual}' does not match runtime target descriptor '${result.targetMismatch.expected}'.`,
      {
        actual: result.targetMismatch.actual,
        expected: result.targetMismatch.expected,
      },
    );
  }

  if (result.missingExtensionPackIds.length > 0) {
    const packIds = result.missingExtensionPackIds;
    const packList = packIds.map((id) => `'${id}'`).join(', ');
    throw runtimeError(
      'RUNTIME.MISSING_EXTENSION_PACK',
      `Contract requires extension pack(s) ${packList}, but runtime descriptors do not provide matching component(s).`,
      { packIds },
    );
  }
}

// ============================================================================
// Parameterized Type Validation
// ============================================================================

/**
 * Validates typeParams against the codec's paramsSchema.
 * @throws RuntimeErrorEnvelope with code RUNTIME.TYPE_PARAMS_INVALID if validation fails
 */
function validateTypeParams(
  typeParams: Record<string, unknown>,
  codecDescriptor: RuntimeParameterizedCodecDescriptor,
  context: { typeName?: string; tableName?: string; columnName?: string },
): Record<string, unknown> {
  const result = codecDescriptor.paramsSchema(typeParams);
  if (result instanceof arktype.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    const locationInfo = context.typeName
      ? `type '${context.typeName}'`
      : `column '${context.tableName}.${context.columnName}'`;
    throw runtimeError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `Invalid typeParams for ${locationInfo} (codecId: ${codecDescriptor.codecId}): ${messages}`,
      { ...context, codecId: codecDescriptor.codecId, typeParams },
    );
  }
  return result as Record<string, unknown>;
}

/**
 * Collects parameterized codec descriptors from descriptors with static contributions.
 * Returns a map of codecId → descriptor for quick lookup.
 * @throws RuntimeErrorEnvelope with code RUNTIME.DUPLICATE_PARAMETERIZED_CODEC if duplicate codecIds are found
 */
function collectParameterizedCodecDescriptors(
  contributors: ReadonlyArray<SqlStaticContributions>,
): Map<string, RuntimeParameterizedCodecDescriptor> {
  const descriptors = new Map<string, RuntimeParameterizedCodecDescriptor>();

  for (const contributor of contributors) {
    for (const descriptor of contributor.parameterizedCodecs()) {
      if (descriptors.has(descriptor.codecId)) {
        throw runtimeError(
          'RUNTIME.DUPLICATE_PARAMETERIZED_CODEC',
          `Duplicate parameterized codec descriptor for codecId '${descriptor.codecId}'.`,
          { codecId: descriptor.codecId },
        );
      }
      descriptors.set(descriptor.codecId, descriptor);
    }
  }

  return descriptors;
}

/**
 * Initializes type helpers from storage.types using codec descriptors.
 *
 * For each named type instance in `storage.types`:
 * - If a codec descriptor exists with an `init` hook: calls the hook and stores the result
 * - Otherwise: stores the full type instance metadata directly (codecId, nativeType, typeParams)
 *
 * This matches the typing in `ExtractSchemaTypes<Contract>` which extracts
 * `Contract['storage']['types']` directly, ensuring runtime values match static types
 * when no init hook transforms the value.
 */
function initializeTypeHelpers(
  storageTypes: Record<string, StorageTypeInstance> | undefined,
  codecDescriptors: Map<string, RuntimeParameterizedCodecDescriptor>,
): TypeHelperRegistry {
  const helpers: TypeHelperRegistry = {};

  if (!storageTypes) {
    return helpers;
  }

  for (const [typeName, typeInstance] of Object.entries(storageTypes)) {
    const descriptor = codecDescriptors.get(typeInstance.codecId);

    if (descriptor) {
      // Validate typeParams against the codec's schema
      const validatedParams = validateTypeParams(typeInstance.typeParams, descriptor, {
        typeName,
      });

      // Call init hook if provided, otherwise store full type instance
      if (descriptor.init) {
        helpers[typeName] = descriptor.init(validatedParams);
      } else {
        // No init hook: expose full type instance metadata (matches contract typing)
        helpers[typeName] = typeInstance;
      }
    } else {
      // No descriptor found: expose full type instance (no validation possible)
      helpers[typeName] = typeInstance;
    }
  }

  return helpers;
}

/**
 * Validates inline column typeParams across all tables.
 * @throws RuntimeErrorEnvelope with code RUNTIME.TYPE_PARAMS_INVALID if validation fails
 */
function validateColumnTypeParams(
  storage: SqlStorage,
  codecDescriptors: Map<string, RuntimeParameterizedCodecDescriptor>,
): void {
  for (const [tableName, table] of Object.entries(storage.tables)) {
    for (const [columnName, column] of Object.entries(table.columns)) {
      if (column.typeParams) {
        const descriptor = codecDescriptors.get(column.codecId);
        if (descriptor) {
          validateTypeParams(column.typeParams, descriptor, { tableName, columnName });
        }
      }
    }
  }
}

export function createExecutionContext<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  TTargetId extends string = string,
>(options: {
  readonly contract: TContract;
  readonly stack: SqlExecutionStack<TTargetId>;
}): ExecutionContext<TContract> {
  const { contract, stack } = options;

  assertExecutionStackContractRequirements(contract, stack);

  const codecRegistry = createCodecRegistry();
  const operationRegistry = createOperationRegistry();

  const contributors: SqlStaticContributions[] = [
    stack.target,
    stack.adapter,
    ...stack.extensionPacks,
  ];

  for (const contributor of contributors) {
    for (const c of contributor.codecs().values()) {
      codecRegistry.register(c);
    }
    for (const operation of contributor.operationSignatures()) {
      operationRegistry.register(operation);
    }
  }

  const parameterizedCodecDescriptors = collectParameterizedCodecDescriptors(contributors);

  if (parameterizedCodecDescriptors.size > 0) {
    validateColumnTypeParams(contract.storage, parameterizedCodecDescriptors);
  }

  const types = initializeTypeHelpers(contract.storage.types, parameterizedCodecDescriptors);

  return {
    contract,
    operations: operationRegistry,
    codecs: codecRegistry,
    types,
  };
}
