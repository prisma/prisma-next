import type {
  RuntimeAdapterDescriptor,
  RuntimeAdapterInstance,
  RuntimeDriverDescriptor,
  RuntimeDriverInstance,
  RuntimeExtensionDescriptor,
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
import type { Runtime, RuntimeContext, RuntimeOptions } from '@prisma-next/sql-runtime';
import { createRuntime, createRuntimeContext, type Extension } from '@prisma-next/sql-runtime';

/**
 * SQL runtime driver instance type.
 * Combines identity properties with SQL-specific behavior methods.
 */
export type SqlRuntimeDriverInstance<TTargetId extends string = string> = RuntimeDriverInstance<
  'sql',
  TTargetId
> &
  SqlDriver;

/**
 * SQL runtime adapter instance type.
 * Combines identity properties with SQL-specific adapter behavior.
 */
export type SqlRuntimeAdapterInstance<TTargetId extends string = string> = RuntimeAdapterInstance<
  'sql',
  TTargetId
> &
  Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>;

function assertRuntimeContractRequirements(
  contract: SqlContract<SqlStorage>,
  target: RuntimeTargetDescriptor<'sql', string>,
  adapter: RuntimeAdapterDescriptor<'sql', string, SqlRuntimeAdapterInstance>,
  extensions: readonly RuntimeExtensionDescriptor<'sql', string>[],
): void {
  if (contract.target !== target.targetId) {
    throw new Error(
      `Contract target '${contract.target}' does not match runtime target descriptor '${target.targetId}'.`,
    );
  }

  const requiredPacks = contract.extensionPacks ? Object.keys(contract.extensionPacks) : [];
  if (requiredPacks.length === 0) {
    return;
  }

  const providedIds = new Set<string>([target.id, adapter.id]);
  for (const extension of extensions) {
    providedIds.add(extension.id);
  }

  for (const packId of requiredPacks) {
    if (!providedIds.has(packId)) {
      throw new Error(
        `Contract requires extension pack '${packId}', but runtime descriptors do not provide a matching component.`,
      );
    }
  }
}

/**
 * SQL runtime family instance interface.
 * Extends base RuntimeFamilyInstance with SQL-specific runtime creation method.
 */
export interface SqlRuntimeFamilyInstance extends RuntimeFamilyInstance<'sql'> {
  /**
   * Creates a SQL runtime from contract, adapter, driver, and extensions.
   *
   * @param options - Runtime creation options
   * @param options.contract - SQL contract
   * @param options.driverOptions - Driver options (e.g., PostgresDriverOptions)
   * @param options.verify - Runtime verification options
   * @param options.extensions - Optional extensions (Extension objects, not descriptors)
   * @param options.plugins - Optional plugins
   * @param options.mode - Optional runtime mode
   * @param options.log - Optional log instance
   * @returns Runtime instance
   */
  createRuntime<TContract extends SqlContract<SqlStorage>>(options: {
    readonly contract: TContract;
    readonly driverOptions: unknown;
    readonly verify: RuntimeVerifyOptions;
    readonly extensions?: readonly Extension[];
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
 */
export function createSqlRuntimeFamilyInstance(options: {
  readonly target: RuntimeTargetDescriptor<'sql', string>;
  readonly adapter: RuntimeAdapterDescriptor<'sql', string, SqlRuntimeAdapterInstance>;
  readonly driver: RuntimeDriverDescriptor<'sql', string, SqlRuntimeDriverInstance>;
  readonly extensions: readonly RuntimeExtensionDescriptor<'sql', string>[];
}): SqlRuntimeFamilyInstance {
  const {
    target: targetDescriptor,
    adapter: adapterDescriptor,
    driver: driverDescriptor,
    extensions: extensionDescriptors,
  } = options;

  return {
    familyId: 'sql' as const,
    createRuntime<TContract extends SqlContract<SqlStorage>>(runtimeOptions: {
      readonly contract: TContract;
      readonly driverOptions: unknown;
      readonly verify: RuntimeVerifyOptions;
      readonly extensions?: readonly Extension[];
      readonly plugins?: readonly Plugin<
        TContract,
        Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>,
        SqlDriver
      >[];
      readonly mode?: 'strict' | 'permissive';
      readonly log?: Log;
    }): Runtime {
      assertRuntimeContractRequirements(
        runtimeOptions.contract,
        targetDescriptor,
        adapterDescriptor,
        extensionDescriptors,
      );
      const adapterInstance = adapterDescriptor.create();
      const driverInstance = driverDescriptor.create(runtimeOptions.driverOptions);

      const extensionInstances = extensionDescriptors.map((ext) => ext.create());

      const descriptorExtensions: Extension[] = extensionInstances.map((ext) => {
        const extension: Extension = {};
        if ('codecs' in ext && typeof ext.codecs === 'function') {
          extension.codecs =
            ext.codecs as () => import('@prisma-next/sql-relational-core/ast').CodecRegistry;
        }
        if ('operations' in ext && typeof ext.operations === 'function') {
          extension.operations =
            ext.operations as () => readonly import('@prisma-next/sql-operations').SqlOperationSignature[];
        }
        return extension;
      });

      const extensions = [...descriptorExtensions, ...(runtimeOptions.extensions ?? [])];

      const context = createRuntimeContext({
        contract: runtimeOptions.contract,
        adapter: adapterInstance,
        extensions,
      }) as RuntimeContext<TContract>;

      const runtimeOptions_: RuntimeOptions<TContract> = {
        adapter: adapterInstance,
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
