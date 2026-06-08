import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import { SqlContractSerializer } from '@prisma-next/family-sql/ir';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import { sql } from '@prisma-next/sql-builder/runtime';
import { orm } from '@prisma-next/sql-orm-client';
import {
  createExecutionContext,
  createRuntime,
  createSqlExecutionStack,
  type Runtime,
} from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import { Pool } from 'pg';
import { contract } from './contract';

export const stack = createSqlExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  driver: postgresDriver,
});

// Pass the TS-authored contract directly. The deserializer's method-level type
// parameter recovers the literal-typed contract shape (including enum value
// unions) so downstream DSL calls keep their precise types.
const validatedContract = new SqlContractSerializer().deserializeContract<typeof contract>(
  contract,
);

export const context = createExecutionContext({ contract: validatedContract, stack });

export const queries = sql<typeof contract>({
  context,
  rawCodecInferer: { inferCodec: () => 'pg/text' },
});

export function createOrmClient(runtime: Runtime) {
  return orm({ runtime, context });
}

export async function getRuntime(
  databaseUrl: string,
): Promise<{ runtime: Runtime; close: () => Promise<void> }> {
  const pool = new Pool({ connectionString: databaseUrl });
  const stackInstance = instantiateExecutionStack(stack);
  const driver = stackInstance.driver;
  if (!driver) {
    throw new Error('Driver descriptor missing from execution stack');
  }
  try {
    await driver.connect({ kind: 'pgPool', pool });
  } catch (error) {
    await pool.end();
    throw error;
  }
  const runtime = createRuntime({ stackInstance, context, driver });
  return {
    runtime,
    close: async () => {
      await pool.end();
    },
  };
}
