import type {
  RuntimeAdapterDescriptor,
  RuntimeAdapterInstance,
  RuntimeExtensionDescriptor,
  RuntimeExtensionInstance,
  RuntimeTargetDescriptor,
} from '@prisma-next/core-execution-plane/types';
import { createOperationRegistry } from '@prisma-next/operations';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import type {
  Adapter,
  CodecRegistry,
  LoweredStatement,
  QueryAst,
} from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { QueryLaneContext } from '@prisma-next/sql-relational-core/query-lane-context';

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

// ============================================================================
// SQL Runtime Context
// ============================================================================

export interface RuntimeContext<TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>>
  extends QueryLaneContext<TContract> {
  readonly adapter:
    | Adapter<QueryAst, TContract, LoweredStatement>
    | Adapter<QueryAst, SqlContract<SqlStorage>, LoweredStatement>;
}

/**
 * Descriptor-first options for creating a SQL runtime context.
 * Takes the same framework composition as control-plane: target, adapter, extensionPacks.
 *
 * @template TContract - The SQL contract type
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 */
export interface CreateRuntimeContextOptions<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  TTargetId extends string = string,
> {
  readonly contract: TContract;
  readonly target: RuntimeTargetDescriptor<'sql', TTargetId>;
  readonly adapter: RuntimeAdapterDescriptor<
    'sql',
    TTargetId,
    SqlRuntimeAdapterInstance<TTargetId>
  >;
  readonly extensionPacks?: ReadonlyArray<SqlRuntimeExtensionDescriptor<TTargetId>>;
}

/**
 * Creates a SQL runtime context from descriptor-first composition.
 *
 * The context includes:
 * - The validated contract
 * - The adapter instance (created from descriptor)
 * - Codec registry (populated from adapter + extension instances)
 * - Operation registry (populated from extension instances)
 *
 * @param options - Descriptor-first composition options
 * @returns RuntimeContext with registries wired from all components
 */
export function createRuntimeContext<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  TTargetId extends string = string,
>(options: CreateRuntimeContextOptions<TContract, TTargetId>): RuntimeContext<TContract> {
  const { contract, adapter: adapterDescriptor, extensionPacks } = options;

  // Create adapter instance from descriptor
  // The adapter instance IS an Adapter (via intersection)
  const adapterInstance = adapterDescriptor.create();

  // Create registries
  const codecRegistry = createCodecRegistry();
  const operationRegistry = createOperationRegistry();

  // Register adapter codecs (adapter instance has profile.codecs())
  const adapterCodecs = adapterInstance.profile.codecs();
  for (const codec of adapterCodecs.values()) {
    codecRegistry.register(codec);
  }

  // Create extension instances and register their codecs/operations
  for (const extDescriptor of extensionPacks ?? []) {
    const extInstance = extDescriptor.create();

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

  return {
    contract,
    adapter: adapterInstance,
    operations: operationRegistry,
    codecs: codecRegistry,
  };
}
