import { checkContractComponentRequirements } from '@prisma-next/contract/framework-components';
import type { ExecutionStackInstance } from '@prisma-next/core-execution-plane/stack';
import type {
  RuntimeAdapterInstance,
  RuntimeDriverInstance,
  RuntimeExtensionDescriptor,
  RuntimeExtensionInstance,
} from '@prisma-next/core-execution-plane/types';
import { createOperationRegistry } from '@prisma-next/operations';
import { runtimeError } from '@prisma-next/runtime-executor';
import type { SqlContract, SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import type {
  Adapter,
  CodecParamsDescriptor,
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
import { type as arktype } from 'arktype';

// ============================================================================
// Runtime Parameterized Codec Descriptor Types
// ============================================================================

/**
 * Runtime parameterized codec descriptor.
 * Provides validation schema and optional init hook for codecs that support type parameters.
 * Used at runtime to validate typeParams and create type helpers.
 *
 * This is a type alias for `CodecParamsDescriptor` from the AST layer,
 * which is the shared definition used by both adapter and runtime.
 */
export type RuntimeParameterizedCodecDescriptor<
  TParams = Record<string, unknown>,
  THelper = unknown,
> = CodecParamsDescriptor<TParams, THelper>;

// ============================================================================
// SQL Runtime Extension Types
// ============================================================================

/**
 * SQL runtime extension instance.
 * Extends the framework RuntimeExtensionInstance with SQL-specific hooks
 * for contributing codecs and operations to the runtime context.
 *
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export interface SqlRuntimeExtensionInstance<TTargetId extends string>
  extends RuntimeExtensionInstance<'sql', TTargetId> {
  /** Returns codecs to register in the runtime context. */
  codecs?(): CodecRegistry;
  /** Returns operations to register in the runtime context. */
  operations?(): ReadonlyArray<SqlOperationSignature>;
  /**
   * Returns parameterized codec descriptors for type validation and helper creation.
   * Uses unknown for type parameters to allow any concrete descriptor types.
   */
  // biome-ignore lint/suspicious/noExplicitAny: needed for covariance with concrete descriptor types
  parameterizedCodecs?(): ReadonlyArray<RuntimeParameterizedCodecDescriptor<any, any>>;
}

/**
 * SQL runtime extension descriptor.
 * Extends the framework RuntimeExtensionDescriptor with SQL-specific instance type.
 *
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export interface SqlRuntimeExtensionDescriptor<TTargetId extends string>
  extends RuntimeExtensionDescriptor<'sql', TTargetId, SqlRuntimeExtensionInstance<TTargetId>> {
  create(): SqlRuntimeExtensionInstance<TTargetId>;
}

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
  stack: ExecutionStackInstance<
    'sql',
    string,
    SqlRuntimeAdapterInstance<string>,
    RuntimeDriverInstance<'sql', string>,
    SqlRuntimeExtensionInstance<string>
  >['stack'],
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
 * Collects parameterized codec descriptors from extension instances.
 * Returns a map of codecId → descriptor for quick lookup.
 * @throws RuntimeErrorEnvelope with code RUNTIME.DUPLICATE_PARAMETERIZED_CODEC if duplicate codecIds are found
 */
function collectParameterizedCodecDescriptors(
  providers: ReadonlyArray<{
    parameterizedCodecs?(): ReadonlyArray<RuntimeParameterizedCodecDescriptor>;
  }>,
): Map<string, RuntimeParameterizedCodecDescriptor> {
  const descriptors = new Map<string, RuntimeParameterizedCodecDescriptor>();

  for (const provider of providers) {
    const paramCodecs = provider.parameterizedCodecs?.();
    if (paramCodecs) {
      for (const descriptor of paramCodecs) {
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
  readonly stackInstance: ExecutionStackInstance<
    'sql',
    TTargetId,
    SqlRuntimeAdapterInstance<TTargetId>,
    RuntimeDriverInstance<'sql', TTargetId>,
    SqlRuntimeExtensionInstance<TTargetId>
  >;
}): ExecutionContext<TContract> {
  const { contract, stackInstance } = options;
  const { adapter: adapterInstance, extensionPacks: extensionInstances } = stackInstance;

  assertExecutionStackContractRequirements(contract, stackInstance.stack);

  const codecRegistry = createCodecRegistry();
  const operationRegistry = createOperationRegistry();

  const adapterCodecs = adapterInstance.profile.codecs();
  for (const codec of adapterCodecs.values()) {
    codecRegistry.register(codec);
  }

  for (const extInstance of extensionInstances) {
    const extCodecs = extInstance.codecs?.();
    if (extCodecs) {
      for (const codec of extCodecs.values()) {
        codecRegistry.register(codec);
      }
    }

    const extOperations = extInstance.operations?.();
    if (extOperations) {
      for (const operation of extOperations) {
        operationRegistry.register(operation);
      }
    }
  }

  const parameterizedCodecDescriptors = collectParameterizedCodecDescriptors([
    adapterInstance as {
      parameterizedCodecs?(): ReadonlyArray<RuntimeParameterizedCodecDescriptor>;
    },
    ...(extensionInstances as ReadonlyArray<SqlRuntimeExtensionInstance<string>>),
  ]);

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
