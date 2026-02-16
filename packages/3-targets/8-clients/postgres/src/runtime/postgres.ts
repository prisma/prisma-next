import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import { instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import type {
  ExtractCodecTypes,
  ExtractOperationTypes,
  SqlContract,
  SqlStorage,
} from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import type { SelectBuilder } from '@prisma-next/sql-lane';
import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import type { OrmRegistry } from '@prisma-next/sql-orm-lane';
import { orm as ormBuilder } from '@prisma-next/sql-orm-lane';
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
import { Pool } from 'pg';
import { type PostgresBindingInput, resolvePostgresBinding } from './binding';

type NormalizeOperationTypes<T> = {
  [TypeId in keyof T]: {
    [Method in keyof T[TypeId]]: T[TypeId][Method] extends OperationTypeSignature
      ? T[TypeId][Method]
      : OperationTypeSignature;
  };
};

type ToSchemaOperationTypes<T> = T extends OperationTypes ? T : NormalizeOperationTypes<T>;

export type PostgresTargetId = 'postgres';

export interface PostgresClient<TContract extends SqlContract<SqlStorage>> {
  readonly sql: SelectBuilder<
    TContract,
    unknown,
    ExtractCodecTypes<TContract>,
    ExtractOperationTypes<TContract>
  >;
  readonly schema: SchemaHandle<
    TContract,
    ExtractCodecTypes<TContract>,
    ToSchemaOperationTypes<ExtractOperationTypes<TContract>>
  >;
  readonly orm: OrmRegistry<TContract, ExtractCodecTypes<TContract>>;
  readonly context: ExecutionContext<TContract>;
  readonly stack: SqlExecutionStackWithDriver<PostgresTargetId>;
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

export type PostgresOptionsWithContract<TContract extends SqlContract<SqlStorage>> =
  PostgresBindingInput &
    PostgresOptionsBase<TContract> & {
      readonly contract: TContract;
      readonly contractJson?: never;
    };

export type PostgresOptionsWithContractJson<TContract extends SqlContract<SqlStorage>> =
  PostgresBindingInput &
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
  const binding = resolvePostgresBinding(options);
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
  const orm = ormBuilder({ context });

  let runtimeInstance: Runtime | undefined;

  return {
    sql,
    schema,
    orm,
    context,
    stack,
    runtime() {
      if (runtimeInstance) {
        return runtimeInstance;
      }

      const stackInstance = instantiateExecutionStack(stack);
      const driverDescriptor = stack.driver;
      if (!driverDescriptor) {
        throw new Error('Driver descriptor missing from execution stack');
      }

      const connect =
        binding.kind === 'url'
          ? {
              pool: new Pool({
                connectionString: binding.url,
                connectionTimeoutMillis: options.poolOptions?.connectionTimeoutMillis ?? 20_000,
                idleTimeoutMillis: options.poolOptions?.idleTimeoutMillis ?? 30_000,
              }),
            }
          : binding.kind === 'pgPool'
            ? { pool: binding.pool }
            : { client: binding.client };

      const driver = driverDescriptor.create({
        connect,
        cursor: { disabled: true },
      });

      runtimeInstance = createRuntime({
        stackInstance,
        context,
        driver,
        verify: options.verify ?? { mode: 'onFirstUse', requireMarker: false },
        ...(options.plugins ? { plugins: options.plugins } : {}),
      });

      return runtimeInstance;
    },
  };
}
