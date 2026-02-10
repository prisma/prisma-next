import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import { instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { orm as ormBuilder } from '@prisma-next/sql-orm-lane';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import type { Runtime } from '@prisma-next/sql-runtime';
import {
  createExecutionContext,
  createRuntime,
  createSqlExecutionStack,
} from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import { Pool } from 'pg';
import { resolvePostgresBinding } from './binding';
import type {
  PostgresClient,
  PostgresOptions,
  PostgresOptionsWithContract,
  PostgresOptionsWithContractJson,
} from './types';

function hasContractJson<TContract extends SqlContract<SqlStorage>>(
  options: PostgresOptions<TContract>,
): options is PostgresOptionsWithContractJson<TContract> {
  return 'contractJson' in options;
}

function resolveContract<TContract extends SqlContract<SqlStorage>>(
  options: PostgresOptions<TContract>,
): TContract {
  if (hasContractJson(options)) {
    return validateContract<TContract>(options.contractJson);
  }
  return (options as PostgresOptionsWithContract<TContract>).contract;
}

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

  const schema = schemaBuilder(context);
  const sql = sqlBuilder({ context });
  const orm = ormBuilder({ context });

  let runtimeInstance: Runtime | undefined;

  return {
    sql,
    schema: schema as PostgresClient<TContract>['schema'],
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
          ? { pool: new Pool({ connectionString: binding.url }) }
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
