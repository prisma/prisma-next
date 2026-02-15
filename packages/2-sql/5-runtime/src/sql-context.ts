import { checkContractComponentRequirements } from '@prisma-next/contract/framework-components';
import type { ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import { createExecutionStack, type ExecutionStack } from '@prisma-next/core-execution-plane/stack';
import type {
  RuntimeAdapterDescriptor,
  RuntimeAdapterInstance,
  RuntimeDriverDescriptor,
  RuntimeDriverInstance,
  RuntimeExtensionDescriptor,
  RuntimeExtensionInstance,
  RuntimeTargetDescriptor,
  RuntimeTargetInstance,
} from '@prisma-next/core-execution-plane/types';
import { generateId } from '@prisma-next/ids/runtime';
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
  AppliedMutationDefault,
  ExecutionContext,
  MutationDefaultsOptions,
  TypeHelperRegistry,
} from '@prisma-next/sql-relational-core/query-lane-context';
import { type as arktype } from 'arktype';

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

export interface SqlStaticContributions {
  readonly codecs: () => CodecRegistry;
  readonly operationSignatures: () => ReadonlyArray<SqlOperationSignature>;
  // biome-ignore lint/suspicious/noExplicitAny: needed for covariance with concrete descriptor types
  readonly parameterizedCodecs: () => ReadonlyArray<RuntimeParameterizedCodecDescriptor<any, any>>;
}

export interface SqlRuntimeTargetDescriptor<
  TTargetId extends string = string,
  TTargetInstance extends RuntimeTargetInstance<'sql', TTargetId> = RuntimeTargetInstance<
    'sql',
    TTargetId
  >,
> extends RuntimeTargetDescriptor<'sql', TTargetId, TTargetInstance>,
    SqlStaticContributions {}

export interface SqlRuntimeAdapterDescriptor<
  TTargetId extends string = string,
  TAdapterInstance extends RuntimeAdapterInstance<
    'sql',
    TTargetId
  > = SqlRuntimeAdapterInstance<TTargetId>,
> extends RuntimeAdapterDescriptor<'sql', TTargetId, TAdapterInstance>,
    SqlStaticContributions {}

export interface SqlRuntimeExtensionDescriptor<TTargetId extends string = string>
  extends RuntimeExtensionDescriptor<'sql', TTargetId, SqlRuntimeExtensionInstance<TTargetId>>,
    SqlStaticContributions {
  create(): SqlRuntimeExtensionInstance<TTargetId>;
}

export interface SqlExecutionStack<TTargetId extends string = string> {
  readonly target: SqlRuntimeTargetDescriptor<TTargetId>;
  readonly adapter: SqlRuntimeAdapterDescriptor<TTargetId>;
  readonly extensionPacks: readonly SqlRuntimeExtensionDescriptor<TTargetId>[];
}

export type SqlExecutionStackWithDriver<TTargetId extends string = string> = Omit<
  ExecutionStack<
    'sql',
    TTargetId,
    SqlRuntimeAdapterInstance<TTargetId>,
    SqlRuntimeDriverInstance<TTargetId>,
    SqlRuntimeExtensionInstance<TTargetId>
  >,
  'target' | 'adapter' | 'driver' | 'extensionPacks'
> & {
  readonly target: SqlRuntimeTargetDescriptor<TTargetId>;
  readonly adapter: SqlRuntimeAdapterDescriptor<TTargetId, SqlRuntimeAdapterInstance<TTargetId>>;
  readonly driver:
    | RuntimeDriverDescriptor<'sql', TTargetId, unknown, SqlRuntimeDriverInstance<TTargetId>>
    | undefined;
  readonly extensionPacks: readonly SqlRuntimeExtensionDescriptor<TTargetId>[];
};

export interface SqlRuntimeExtensionInstance<TTargetId extends string>
  extends RuntimeExtensionInstance<'sql', TTargetId> {}

export type SqlRuntimeAdapterInstance<TTargetId extends string = string> = RuntimeAdapterInstance<
  'sql',
  TTargetId
> &
  Adapter<QueryAst, SqlContract<SqlStorage>, LoweredStatement>;

export type SqlRuntimeDriverInstance<TTargetId extends string = string> = RuntimeDriverInstance<
  'sql',
  TTargetId
> &
  SqlDriver<unknown>;

export function createSqlExecutionStack<TTargetId extends string>(options: {
  readonly target: SqlRuntimeTargetDescriptor<TTargetId>;
  readonly adapter: SqlRuntimeAdapterDescriptor<TTargetId>;
  readonly driver?:
    | RuntimeDriverDescriptor<'sql', TTargetId, unknown, SqlRuntimeDriverInstance<TTargetId>>
    | undefined;
  readonly extensionPacks?: readonly SqlRuntimeExtensionDescriptor<TTargetId>[] | undefined;
}): SqlExecutionStackWithDriver<TTargetId> {
  return createExecutionStack({
    target: options.target,
    adapter: options.adapter,
    driver: options.driver,
    extensionPacks: options.extensionPacks,
  });
}

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
      const validatedParams = validateTypeParams(typeInstance.typeParams, descriptor, {
        typeName,
      });

      if (descriptor.init) {
        helpers[typeName] = descriptor.init(validatedParams);
      } else {
        helpers[typeName] = typeInstance;
      }
    } else {
      helpers[typeName] = typeInstance;
    }
  }

  return helpers;
}

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

function computeExecutionDefaultValue(spec: ExecutionMutationDefaultValue): unknown {
  switch (spec.kind) {
    case 'generator':
      return generateId(spec.params ? { id: spec.id, params: spec.params } : { id: spec.id });
  }
}

function applyMutationDefaults(
  contract: SqlContract<SqlStorage>,
  options: MutationDefaultsOptions,
): ReadonlyArray<AppliedMutationDefault> {
  const defaults = contract.execution?.mutations.defaults ?? [];
  if (defaults.length === 0) {
    return [];
  }

  const applied: AppliedMutationDefault[] = [];
  const appliedColumns = new Set<string>();

  for (const mutationDefault of defaults) {
    if (mutationDefault.ref.table !== options.table) {
      continue;
    }

    const defaultSpec =
      options.op === 'create' ? mutationDefault.onCreate : mutationDefault.onUpdate;
    if (!defaultSpec) {
      continue;
    }

    const columnName = mutationDefault.ref.column;
    if (Object.hasOwn(options.values, columnName) || appliedColumns.has(columnName)) {
      continue;
    }

    applied.push({
      column: columnName,
      value: computeExecutionDefaultValue(defaultSpec),
    });
    appliedColumns.add(columnName);
  }

  return applied;
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
    applyMutationDefaults: (options) => applyMutationDefaults(contract, options),
  };
}
