import { assertRuntimeContractRequirementsSatisfied } from '@prisma-next/core-execution-plane/framework-components';
import type {
  RuntimeAdapterDescriptor,
  RuntimeDriverDescriptor,
  RuntimeDriverInstance,
  RuntimeFamilyDescriptor,
  RuntimeFamilyInstance,
  RuntimeTargetDescriptor,
} from '@prisma-next/core-execution-plane/types';
import type { Log, Plugin, RuntimeVerifyOptions } from '@prisma-next/runtime-executor';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  Adapter,
  LoweredStatement,
  SelectAst,
  SqlDriver,
} from '@prisma-next/sql-relational-core/ast';
import type {
  Runtime,
  RuntimeOptions,
  SqlRuntimeAdapterInstance,
  SqlRuntimeExtensionDescriptor,
} from '@prisma-next/sql-runtime';
import { createRuntime, createRuntimeContext } from '@prisma-next/sql-runtime';

/**
 * SQL runtime driver instance type.
 * Combines identity properties with SQL-specific behavior methods.
 */
export type SqlRuntimeDriverInstance<TTargetId extends string = string> = RuntimeDriverInstance<
  'sql',
  TTargetId
> &
  SqlDriver;

// Re-export SqlRuntimeAdapterInstance from sql-runtime for consumers
export type { SqlRuntimeAdapterInstance } from '@prisma-next/sql-runtime';

/**
 * SQL runtime family instance interface.
 * Extends base RuntimeFamilyInstance with SQL-specific runtime creation method.
 */
export interface SqlRuntimeFamilyInstance extends RuntimeFamilyInstance<'sql'> {
  /**
   * Creates a SQL runtime from contract, driver options, and verification settings.
   *
   * Extension packs are routed through composition (at instance creation time),
   * not through this method. This aligns with control-plane composition patterns.
   *
   * @param options - Runtime creation options
   * @param options.contract - SQL contract
   * @param options.driverOptions - Driver options (e.g., PostgresDriverOptions)
   * @param options.verify - Runtime verification options
   * @param options.plugins - Optional plugins
   * @param options.mode - Optional runtime mode
   * @param options.log - Optional log instance
   * @returns Runtime instance
   */
  createRuntime<TContract extends SqlContract<SqlStorage>>(options: {
    readonly contract: TContract;
    readonly driverOptions: unknown;
    readonly verify: RuntimeVerifyOptions;
    readonly plugins?: readonly Plugin<
      TContract,
      Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>,
      SqlDriver
    >[];
    readonly mode?: 'strict' | 'permissive';
    readonly log?: Log;
  }): Runtime;
}

/**
 * Creates a SQL runtime family instance from runtime descriptors.
 *
 * Routes the same framework composition as control-plane:
 * family, target, adapter, driver, extensionPacks (all as descriptors with IDs).
 */
export function createSqlRuntimeFamilyInstance<TTargetId extends string>(options: {
  readonly family: RuntimeFamilyDescriptor<'sql'>;
  readonly target: RuntimeTargetDescriptor<'sql', TTargetId>;
  readonly adapter: RuntimeAdapterDescriptor<
    'sql',
    TTargetId,
    SqlRuntimeAdapterInstance<TTargetId>
  >;
  readonly driver: RuntimeDriverDescriptor<'sql', TTargetId, SqlRuntimeDriverInstance<TTargetId>>;
  readonly extensionPacks?: readonly SqlRuntimeExtensionDescriptor<TTargetId>[];
}): SqlRuntimeFamilyInstance {
  const {
    family: familyDescriptor,
    target: targetDescriptor,
    adapter: adapterDescriptor,
    driver: driverDescriptor,
    extensionPacks: extensionDescriptors = [],
  } = options;

  return {
    familyId: 'sql' as const,
    createRuntime<TContract extends SqlContract<SqlStorage>>(runtimeOptions: {
      readonly contract: TContract;
      readonly driverOptions: unknown;
      readonly verify: RuntimeVerifyOptions;
      readonly plugins?: readonly Plugin<
        TContract,
        Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>,
        SqlDriver
      >[];
      readonly mode?: 'strict' | 'permissive';
      readonly log?: Log;
    }): Runtime {
      // Validate contract requirements against provided descriptors
      assertRuntimeContractRequirementsSatisfied({
        contract: runtimeOptions.contract,
        family: familyDescriptor,
        target: targetDescriptor,
        adapter: adapterDescriptor,
        extensionPacks: extensionDescriptors,
      });

      // Create driver instance
      const driverInstance = driverDescriptor.create(runtimeOptions.driverOptions);

      // Create context via descriptor-first API
      const context = createRuntimeContext<TContract, TTargetId>({
        contract: runtimeOptions.contract,
        target: targetDescriptor,
        adapter: adapterDescriptor,
        extensionPacks: extensionDescriptors,
      });

      const runtimeOptions_: RuntimeOptions<TContract> = {
        driver: driverInstance,
        verify: runtimeOptions.verify,
        context,
        ...(runtimeOptions.plugins ? { plugins: runtimeOptions.plugins } : {}),
        ...(runtimeOptions.mode ? { mode: runtimeOptions.mode } : {}),
        ...(runtimeOptions.log ? { log: runtimeOptions.log } : {}),
      };

      return createRuntime(runtimeOptions_);
    },
  };
}
