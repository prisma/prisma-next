import { createSqliteAdapter } from '@prisma-next/adapter-sqlite/adapter';
import sqliteAdapter from '@prisma-next/adapter-sqlite/runtime';
import type { Contract } from '@prisma-next/contract/types';
import type { SqliteBinding } from '@prisma-next/driver-sqlite/runtime';
import sqliteDriver from '@prisma-next/driver-sqlite/runtime';
import { SqlContractSerializer } from '@prisma-next/family-sql/ir';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import { sql as sqlBuilder } from '@prisma-next/sql-builder/runtime';
import type { Db } from '@prisma-next/sql-builder/types';
import type { ExtractCodecTypes, SqlStorage } from '@prisma-next/sql-contract/types';
import { orm as ormBuilder } from '@prisma-next/sql-orm-client';
import type { CodecTypesBase, RawSqlTag } from '@prisma-next/sql-relational-core/expression';
import { createRawSql } from '@prisma-next/sql-relational-core/expression';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type {
  BindSiteParams,
  Declaration,
  ExecutionContext,
  ParamsFromDeclaration,
  PreparedStatement,
  Runtime,
  SqlExecutionStackWithDriver,
  SqlMiddleware,
  SqlRuntimeExtensionDescriptor,
  VerifyMarkerOption,
} from '@prisma-next/sql-runtime';
import {
  createExecutionContext,
  createRuntime,
  createSqlExecutionStack,
} from '@prisma-next/sql-runtime';
import sqliteTarget from '@prisma-next/target-sqlite/runtime';
import { ifDefined } from '@prisma-next/utils/defined';
import { resolveOptionalSqliteBinding, resolveSqliteBinding } from './binding';

export type SqliteTargetId = 'sqlite';
type OrmClient<TContract extends Contract<SqlStorage>> = ReturnType<typeof ormBuilder<TContract>>;

export interface SqliteClient<TContract extends Contract<SqlStorage>> {
  readonly sql: Db<TContract, RawSqlTag>;
  readonly orm: OrmClient<TContract>;
  readonly rawSql: RawSqlTag;
  readonly context: ExecutionContext<TContract>;
  readonly stack: SqlExecutionStackWithDriver<SqliteTargetId>;
  connect(bindingInput?: { readonly path: string }): Promise<Runtime>;
  runtime(): Runtime;
  prepare<
    D extends Declaration<CT>,
    Row,
    CT extends CodecTypesBase = ExtractCodecTypes<TContract> & CodecTypesBase,
  >(
    declaration: D,
    callback: (sql: Db<TContract, RawSqlTag>, params: BindSiteParams<D>) => SqlQueryPlan<Row>,
  ): Promise<PreparedStatement<ParamsFromDeclaration<D, CT>, Row>>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface SqliteOptionsBase {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<SqliteTargetId>[];
  readonly middleware?: readonly SqlMiddleware[];
  readonly verifyMarker?: VerifyMarkerOption;
}

export type SqliteOptionsWithContract<TContract extends Contract<SqlStorage>> = {
  readonly path?: string;
} & SqliteOptionsBase & {
    readonly contract: TContract;
    readonly contractJson?: never;
  };

export type SqliteOptionsWithContractJson<TContract extends Contract<SqlStorage>> = {
  readonly path?: string;
  readonly _contract?: TContract;
} & SqliteOptionsBase & {
    readonly contractJson: unknown;
    readonly contract?: never;
  };

export type SqliteOptions<TContract extends Contract<SqlStorage>> =
  | SqliteOptionsWithContract<TContract>
  | SqliteOptionsWithContractJson<TContract>;

function resolveContract<TContract extends Contract<SqlStorage>>(
  options: SqliteOptions<TContract>,
): TContract {
  const contractInput =
    'contractJson' in options && options.contractJson !== undefined
      ? options.contractJson
      : (options as SqliteOptionsWithContract<TContract>).contract;
  return new SqlContractSerializer().deserializeContract(contractInput) as TContract;
}

export default function sqlite<TContract extends Contract<SqlStorage>>(
  options: SqliteOptionsWithContract<TContract>,
): SqliteClient<TContract>;
export default function sqlite<TContract extends Contract<SqlStorage>>(
  options: SqliteOptionsWithContractJson<TContract>,
): SqliteClient<TContract>;
export default function sqlite<TContract extends Contract<SqlStorage>>(
  options: SqliteOptions<TContract>,
): SqliteClient<TContract> {
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

  const rawSqlTag: RawSqlTag = createRawSql(createSqliteAdapter());

  const sql: Db<TContract, RawSqlTag> = sqlBuilder<TContract, RawSqlTag>({ context, rawSqlTag });
  let runtimeInstance: Runtime | undefined;
  let runtimeDriver: { connect(binding: unknown): Promise<void> } | undefined;
  let driverConnected = false;
  let connectPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let backgroundConnectError: unknown;
  let closed = false;
  let ownedDispose: (() => Promise<void>) | undefined;

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
    if (closed) {
      throw new Error('SQLite client is closed');
    }

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
    ownedDispose = () => driver.close();
    runtimeDriver = driver;
    if (binding !== undefined) {
      void connectDriver(binding).catch(() => undefined);
    }

    runtimeInstance = createRuntime({
      stackInstance,
      context,
      driver,
      ...ifDefined('verifyMarker', options.verifyMarker),
      ...(options.middleware ? { middleware: options.middleware } : {}),
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
    orm,
    rawSql: rawSqlTag,
    context,
    stack,
    async connect(bindingInput) {
      if (closed) {
        throw new Error('SQLite client is closed');
      }

      if (driverConnected || connectPromise) {
        throw new Error('SQLite client already connected');
      }

      backgroundConnectError = undefined;

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
    prepare<
      D extends Declaration<CT>,
      Row,
      CT extends CodecTypesBase = ExtractCodecTypes<TContract> & CodecTypesBase,
    >(
      declaration: D,
      callback: (sql: Db<TContract, RawSqlTag>, params: BindSiteParams<D>) => SqlQueryPlan<Row>,
    ): Promise<PreparedStatement<ParamsFromDeclaration<D, CT>, Row>> {
      return getRuntime().prepare<D, Row, CT>(declaration, (params) => callback(sql, params));
    },

    close(): Promise<void> {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = (async () => {
        await connectPromise?.catch(() => undefined);
        await ownedDispose?.();
      })();
      return closePromise;
    },

    [Symbol.asyncDispose](): Promise<void> {
      return this.close();
    },
  };
}
