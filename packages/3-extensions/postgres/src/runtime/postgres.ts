import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import { instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import { type KyselifyContract, KyselyPrismaDialect } from '@prisma-next/integration-kysely';
import type {
  ExtractCodecTypes,
  ExtractOperationTypes,
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
import postgresTarget from '@prisma-next/target-postgres/runtime';
import { Kysely } from 'kysely';
import { type Client, Pool } from 'pg';
import {
  type PostgresBinding,
  type PostgresBindingInput,
  resolveOptionalPostgresBinding,
  resolvePostgresBinding,
} from './binding';

type NormalizeOperationTypes<T> = {
  [TypeId in keyof T]: {
    [Method in keyof T[TypeId]]: T[TypeId][Method] extends OperationTypeSignature
      ? T[TypeId][Method]
      : OperationTypeSignature;
  };
};

type ToSchemaOperationTypes<T> = T extends OperationTypes ? T : NormalizeOperationTypes<T>;

export type PostgresTargetId = 'postgres';
type OrmClient<TContract extends SqlContract<SqlStorage>> = ReturnType<
  typeof ormBuilder<TContract>
>;

export interface PostgresClient<TContract extends SqlContract<SqlStorage>> {
  readonly sql: SelectBuilder<
    TContract,
    unknown,
    ExtractCodecTypes<TContract>,
    ExtractOperationTypes<TContract>
  >;
  kysely(runtime: Runtime): Kysely<KyselifyContract<TContract>>;
  readonly schema: SchemaHandle<
    TContract,
    ExtractCodecTypes<TContract>,
    ToSchemaOperationTypes<ExtractOperationTypes<TContract>>
  >;
  readonly orm: OrmClient<TContract>;
  readonly context: ExecutionContext<TContract>;
  readonly stack: SqlExecutionStackWithDriver<PostgresTargetId>;
  connect(bindingInput?: PostgresBindingInput): Runtime;
  runtime(): Runtime;
}

export interface PostgresOptionsBase<TContract extends SqlContract<SqlStorage>> {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<PostgresTargetId>[];
  readonly plugins?: readonly Plugin<TContract>[];
  readonly verify?: RuntimeVerifyOptions;
  readonly poolOptions?: {
    readonly connectionTimeoutMillis?: number;
    readonly idleTimeoutMillis?: number;
  };
}

export interface PostgresBindingOptions {
  readonly binding?: PostgresBinding;
  readonly url?: string;
  readonly pg?: Pool | Client;
}

export type PostgresOptionsWithContract<TContract extends SqlContract<SqlStorage>> =
  PostgresBindingOptions &
    PostgresOptionsBase<TContract> & {
      readonly contract: TContract;
      readonly contractJson?: never;
    };

export type PostgresOptionsWithContractJson<TContract extends SqlContract<SqlStorage>> =
  PostgresBindingOptions &
    PostgresOptionsBase<TContract> & {
      readonly contractJson: unknown;
      readonly contract?: never;
    };

export type PostgresOptions<TContract extends SqlContract<SqlStorage>> =
  | PostgresOptionsWithContract<TContract>
  | PostgresOptionsWithContractJson<TContract>;

function hasContractJson<TContract extends SqlContract<SqlStorage>>(
  options: PostgresOptions<TContract>,
): options is PostgresOptionsWithContractJson<TContract> {
  return 'contractJson' in options;
}

function resolveContract<TContract extends SqlContract<SqlStorage>>(
  options: PostgresOptions<TContract>,
): TContract {
  const contractInput = hasContractJson(options) ? options.contractJson : options.contract;
  return validateContract<TContract>(contractInput);
}

function toRuntimeBinding<TContract extends SqlContract<SqlStorage>>(
  binding: PostgresBinding,
  options: PostgresOptions<TContract>,
) {
  if (binding.kind !== 'url') {
    return binding;
  }

  return {
    kind: 'pgPool',
    pool: new Pool({
      connectionString: binding.url,
      connectionTimeoutMillis: options.poolOptions?.connectionTimeoutMillis ?? 20_000,
      idleTimeoutMillis: options.poolOptions?.idleTimeoutMillis ?? 30_000,
    }),
  } as const;
}

/**
 * Creates a lazy Postgres client from either `contractJson` or a TypeScript-authored `contract`.
 * Static query surfaces are available immediately, while `runtime()` instantiates the driver/pool on first call.
 */
export default function postgres<TContract extends SqlContract<SqlStorage>>(
  options: PostgresOptionsWithContract<TContract>,
): PostgresClient<TContract>;
export default function postgres<TContract extends SqlContract<SqlStorage>>(
  options: PostgresOptionsWithContractJson<TContract>,
): PostgresClient<TContract>;
export default function postgres<TContract extends SqlContract<SqlStorage>>(
  options: PostgresOptions<TContract>,
): PostgresClient<TContract> {
  const contract = resolveContract(options);
  let binding = resolveOptionalPostgresBinding(options);
  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: options.extensions ?? [],
  });

  const context = createExecutionContext({
    contract,
    stack,
  });

  const schema: PostgresClient<TContract>['schema'] = schemaBuilder(context);
  const sql = sqlBuilder({ context });
  let runtimeInstance: Runtime | undefined;
  let runtimeDriver: { connect(binding: unknown): Promise<void> } | undefined;
  let driverConnected = false;
  const getRuntime = (): Runtime => {
    if (runtimeInstance) {
      return runtimeInstance;
    }

    const stackInstance = instantiateExecutionStack(stack);
    const driverDescriptor = stack.driver;
    if (!driverDescriptor) {
      throw new Error('Driver descriptor missing from execution stack');
    }

    const driver = driverDescriptor.create({
      cursor: { disabled: true },
    });
    runtimeDriver = driver;
    if (binding !== undefined) {
      void driver.connect(toRuntimeBinding(binding, options));
      driverConnected = true;
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
    contract,
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
    kysely(runtime: Runtime) {
      return new Kysely<KyselifyContract<TContract>>({
        dialect: new KyselyPrismaDialect({ runtime, contract }),
      });
    },
    schema,
    orm,
    context,
    stack,
    connect(bindingInput) {
      if (bindingInput !== undefined) {
        if (driverConnected) {
          throw new Error('Postgres client already connected');
        }
        binding = resolvePostgresBinding(bindingInput);
      }

      const runtime = getRuntime();
      if (driverConnected) {
        return runtime;
      }

      if (binding === undefined) {
        throw new Error(
          'Postgres binding not configured. Pass url/pg/binding to postgres(...) or call db.connect({ ... }).',
        );
      }

      const driver = runtimeDriver;
      if (!driver) {
        throw new Error('Postgres runtime driver missing');
      }

      void driver.connect(toRuntimeBinding(binding, options));
      driverConnected = true;
      return runtime;
    },
    runtime() {
      return getRuntime();
    },
  };
}
