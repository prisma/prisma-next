import { instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';
import { budgets, createRuntime, type Plugin, type Runtime } from '@prisma-next/sql-runtime';
import { Pool } from 'pg';
import { context, stack } from './context';

export async function getRuntime(
  databaseUrl: string,
  plugins: Plugin<typeof context.contract>[] = [
    budgets({
      maxRows: 10_000,
      defaultTableRows: 10_000,
      tableRows: { user: 10_000, post: 10_000 },
      maxLatencyMs: 1_000,
    }),
  ],
): Promise<Runtime> {
  const pool = new Pool({ connectionString: databaseUrl });

  const stackInstance = instantiateExecutionStack(stack);
  const driverDescriptor = stack.driver;
  if (!driverDescriptor) {
    throw new Error('Driver descriptor missing from execution stack');
  }
  const driver = driverDescriptor.create({ cursor: { disabled: true } });
  await driver.connect({ kind: 'pgPool', pool });

  return createRuntime({
    stackInstance,
    context,
    driver,
    verify: {
      mode: 'onFirstUse',
      requireMarker: false,
    },
    plugins,
  });
}
