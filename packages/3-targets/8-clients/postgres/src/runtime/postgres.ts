import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import { instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';
import type { PostgresDriverCreateOptions } from '@prisma-next/driver-postgres/runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import type {
  CodecTypesOf,
  ExtractCodecTypes,
  ExtractOperationTypes,
  ExtractTypeMapsFromContract,
  OperationTypesOf,
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
import { ifDefined } from '@prisma-next/utils/defined';
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

export interface PostgresClient<
  TContract extends SqlContract<SqlStorage>,
  TTypeMaps = ExtractTypeMapsFromContract<TContract>,
> {
  readonly sql: SelectBuilder<
    TContract,
    unknown,
    [TTypeMaps] extends [never] ? ExtractCodecTypes<TContract> : CodecTypesOf<TTypeMaps>,
    [TTypeMaps] extends [never] ? ExtractOperationTypes<TContract> : OperationTypesOf<TTypeMaps>
  >;
  readonly schema: SchemaHandle<
    TContract,
    [TTypeMaps] extends [never] ? ExtractCodecTypes<TContract> : CodecTypesOf<TTypeMaps>,
    ToSchemaOperationTypes<
      [TTypeMaps] extends [never] ? ExtractOperationTypes<TContract> : OperationTypesOf<TTypeMaps>
    >
  >;
  readonly orm: OrmRegistry<
    TContract,
    [TTypeMaps] extends [never] ? ExtractCodecTypes<TContract> : CodecTypesOf<TTypeMaps>
  >;
  readonly context: ExecutionContext<TContract>;
  readonly stack: SqlExecutionStackWithDriver<PostgresTargetId>;
  runtime(): Promise<Runtime>;
}

export interface PostgresOptionsBase<TContract extends SqlContract<SqlStorage>> {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<PostgresTargetId>[];
  readonly plugins?: readonly Plugin<TContract>[];
  readonly verify?: RuntimeVerifyOptions;
  readonly cursor?: PostgresDriverCreateOptions['cursor'];
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
 *
 * - No-emit: infers TypeMaps from ContractWithTypeMaps. Example: postgres({ contract })
 * - Emitted: pass TypeMaps explicitly. Example: postgres<Contract, TypeMaps>({ contractJson, url })
 */
export default function postgres<
  TContract extends SqlContract<SqlStorage>,
  TTypeMaps = ExtractTypeMapsFromContract<TContract>,
>(options: PostgresOptionsWithContract<TContract>): PostgresClient<TContract, TTypeMaps>;
export default function postgres<
  TContract extends SqlContract<SqlStorage>,
  TTypeMaps = ExtractTypeMapsFromContract<TContract>,
>(options: PostgresOptionsWithContractJson<TContract>): PostgresClient<TContract, TTypeMaps>;
export default function postgres<
  TContract extends SqlContract<SqlStorage>,
  TTypeMaps = ExtractTypeMapsFromContract<TContract>,
>(options: PostgresOptions<TContract>): PostgresClient<TContract, TTypeMaps> {
  const contract = resolveContract(options);
  const binding = resolvePostgresBinding(options);
  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver:
      options.cursor === undefined
        ? postgresDriver
        : {
            ...postgresDriver,
            create() {
              return postgresDriver.create({ cursor: options.cursor });
            },
          },
    extensionPacks: options.extensions ?? [],
  });

  const context = createExecutionContext({
    contract,
    stack,
  });

  const schema = schemaBuilder<TContract, TTypeMaps>(context);
  const sql = sqlBuilder<TContract, TTypeMaps>({ context });
  const orm = ormBuilder<TContract, TTypeMaps>({ context });

  let runtimePromise: Promise<Runtime> | undefined;

  return {
    sql,
    schema: schema as PostgresClient<TContract, TTypeMaps>['schema'],
    orm,
    context,
    stack,
    async runtime() {
      if (runtimePromise) {
        return runtimePromise;
      }

      runtimePromise = (async () => {
        const stackInstance = instantiateExecutionStack(stack);
        const driver = stackInstance.driver;
        if (driver === undefined) {
          throw new Error('Relational runtime requires a driver descriptor on the execution stack');
        }

        try {
          // `binding` is normalized by resolvePostgresBinding(), so this call site remains
          // type-safe in practice while SqlRuntimeDriverInstance currently uses SqlDriver<unknown>.
          await driver.connect(binding);

          return createRuntime({
            stackInstance,
            context,
            driver,
            verify: options.verify ?? { mode: 'onFirstUse', requireMarker: false },
            ...ifDefined('plugins', options.plugins),
          });
        } catch (error) {
          await driver.close().catch(() => undefined);
          throw error;
        }
      })();

      runtimePromise.catch(() => {
        runtimePromise = undefined;
      });

      return runtimePromise;
    },
  };
}
