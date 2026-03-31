import sqliteAdapter from '@prisma-next/adapter-sqlite/runtime';
import { instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';
import type { SqliteBinding } from '@prisma-next/driver-sqlite/runtime';
import sqliteDriver from '@prisma-next/driver-sqlite/runtime';
import type {
  ExtractTypeMapsFromContract,
  ResolveCodecTypes,
  ResolveOperationTypes,
  SqlContract,
  SqlStorage,
} from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import type { SelectBuilder } from '@prisma-next/sql-lane';
import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { orm as ormBuilder } from '@prisma-next/sql-orm-client';
import type { SchemaHandle } from '@prisma-next/sql-relational-core/schema';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import type {
  OperationTypeSignature,
  OperationTypes,
} from '@prisma-next/sql-relational-core/types';
import type {
  ExecutionContext,
  Plugin,
  Runtime,
  RuntimeVerifyOptions,
  SqlExecutionStackWithDriver,
  SqlRuntimeExtensionDescriptor,
} from '@prisma-next/sql-runtime';
import {
  createExecutionContext,
  createRuntime,
  createSqlExecutionStack,
} from '@prisma-next/sql-runtime';
import sqliteTarget from '@prisma-next/target-sqlite/runtime';
import { resolveOptionalSqliteBinding, resolveSqliteBinding } from './binding';

type NormalizeOperationTypes<T> = {
  [TypeId in keyof T]: {
    [Method in keyof T[TypeId]]: T[TypeId][Method] extends OperationTypeSignature
      ? T[TypeId][Method]
      : OperationTypeSignature;
  };
};

type ToSchemaOperationTypes<T> = T extends OperationTypes ? T : NormalizeOperationTypes<T>;

export type SqliteTargetId = 'sqlite';
type OrmClient<TContract extends SqlContract<SqlStorage>> = ReturnType<
  typeof ormBuilder<TContract>
>;

export interface SqliteClient<
  TContract extends SqlContract<SqlStorage>,
  TTypeMaps = ExtractTypeMapsFromContract<TContract>,
> {
  readonly sql: SelectBuilder<
    TContract,
    unknown,
    ResolveCodecTypes<TContract, TTypeMaps>,
    ResolveOperationTypes<TContract, TTypeMaps>
  >;
  readonly schema: SchemaHandle<
    TContract,
    ResolveCodecTypes<TContract, TTypeMaps>,
    ToSchemaOperationTypes<ResolveOperationTypes<TContract, TTypeMaps>>
  >;
  readonly orm: OrmClient<TContract>;
  readonly context: ExecutionContext<TContract>;
  readonly stack: SqlExecutionStackWithDriver<SqliteTargetId>;
  connect(bindingInput?: { readonly path: string }): Promise<Runtime>;
  runtime(): Runtime;
}

export interface SqliteOptionsBase<TContract extends SqlContract<SqlStorage>> {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<SqliteTargetId>[];
  readonly plugins?: readonly Plugin<TContract>[];
  readonly verify?: RuntimeVerifyOptions;
}

export type SqliteOptionsWithContract<TContract extends SqlContract<SqlStorage>> = {
  readonly path?: string;
} & SqliteOptionsBase<TContract> & {
    readonly contract: TContract;
    readonly contractJson?: never;
  };

export type SqliteOptionsWithContractJson<TContract extends SqlContract<SqlStorage>> = {
  readonly path?: string;
} & SqliteOptionsBase<TContract> & {
    readonly contractJson: unknown;
    readonly contract?: never;
  };

export type SqliteOptions<TContract extends SqlContract<SqlStorage>> =
  | SqliteOptionsWithContract<TContract>
  | SqliteOptionsWithContractJson<TContract>;

function resolveContract<TContract extends SqlContract<SqlStorage>>(
  options: SqliteOptions<TContract>,
): TContract {
  const contractInput =
    'contractJson' in options && options.contractJson !== undefined
      ? options.contractJson
      : (options as SqliteOptionsWithContract<TContract>).contract;
  return validateContract<TContract>(contractInput);
}

export default function sqlite<
  TContract extends SqlContract<SqlStorage>,
  TTypeMaps = ExtractTypeMapsFromContract<TContract>,
>(options: SqliteOptionsWithContract<TContract>): SqliteClient<TContract, TTypeMaps>;
export default function sqlite<
  TContract extends SqlContract<SqlStorage>,
  TTypeMaps = ExtractTypeMapsFromContract<TContract>,
>(options: SqliteOptionsWithContractJson<TContract>): SqliteClient<TContract, TTypeMaps>;
export default function sqlite<
  TContract extends SqlContract<SqlStorage>,
  TTypeMaps = ExtractTypeMapsFromContract<TContract>,
>(options: SqliteOptions<TContract>): SqliteClient<TContract, TTypeMaps> {
  const contract = resolveContract(options);
  let binding = resolveOptionalSqliteBinding(options);
  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
    extensionPacks: options.extensions ?? [],
  });

  const context = createExecutionContext({
    contract,
    stack,
  });

  const schema = schemaBuilder<TContract, TTypeMaps>(context);
  const sql = sqlBuilder<TContract, TTypeMaps>({ context });
  let runtimeInstance: Runtime | undefined;
  let runtimeDriver: { connect(binding: unknown): Promise<void> } | undefined;
  let driverConnected = false;
  let connectPromise: Promise<void> | undefined;
  let backgroundConnectError: unknown;

  const connectDriver = async (resolvedBinding: SqliteBinding): Promise<void> => {
    if (driverConnected) return;
    if (!runtimeDriver) throw new Error('SQLite runtime driver missing');
    if (connectPromise) return connectPromise;
    connectPromise = runtimeDriver
      .connect(resolvedBinding)
      .then(() => {
        driverConnected = true;
      })
      .catch((err) => {
        backgroundConnectError = err;
        connectPromise = undefined;
        throw err;
      });
    return connectPromise;
  };

  const getRuntime = (): Runtime => {
    if (backgroundConnectError !== undefined) {
      throw backgroundConnectError;
    }

    if (runtimeInstance) {
      return runtimeInstance;
    }

    const stackInstance = instantiateExecutionStack(stack);
    const driverDescriptor = stack.driver;
    if (!driverDescriptor) {
      throw new Error('Driver descriptor missing from execution stack');
    }

    const driver = driverDescriptor.create();
    runtimeDriver = driver;
    if (binding !== undefined) {
      void connectDriver(binding).catch(() => undefined);
    }

    runtimeInstance = createRuntime({
      stackInstance,
      context,
      driver,
      verify: options.verify ?? { mode: 'onFirstUse', requireMarker: false },
      ...(options.plugins ? { plugins: options.plugins } : {}),
    });

    return runtimeInstance;
  };

  const orm: OrmClient<TContract> = ormBuilder({
    context,
    runtime: {
      execute(plan) {
        return getRuntime().execute(plan);
      },
      connection() {
        return getRuntime().connection();
      },
    },
  });

  return {
    sql,
    schema: schema as SqliteClient<TContract, TTypeMaps>['schema'],
    orm,
    context,
    stack,
    async connect(bindingInput) {
      if (driverConnected || connectPromise) {
        throw new Error('SQLite client already connected');
      }

      if (bindingInput !== undefined) {
        binding = resolveSqliteBinding(bindingInput);
      }

      if (binding === undefined) {
        throw new Error(
          'SQLite binding not configured. Pass path to sqlite(...) or call db.connect({ path }).',
        );
      }

      const runtime = getRuntime();
      if (driverConnected) {
        return runtime;
      }

      await connectDriver(binding);
      return runtime;
    },
    runtime() {
      return getRuntime();
    },
  };
}
