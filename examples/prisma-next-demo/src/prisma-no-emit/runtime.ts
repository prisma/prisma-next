import { instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';
import { budgets, createRuntime, type Plugin, type Runtime } from '@prisma-next/sql-runtime';
import { Pool } from 'pg';
import { executionContext, executionStack } from './context';

export function getRuntime(
  databaseUrl: string,
  plugins: Plugin<typeof executionContext.contract>[] = [
    budgets({
      maxRows: 10_000,
      defaultTableRows: 10_000,
      tableRows: { user: 10_000, post: 10_000 },
      maxLatencyMs: 1_000,
    }),
  ],
): Runtime {
  const pool = new Pool({ connectionString: databaseUrl });

  // Avoid import-time instantiation: instantiate when runtime is requested.
  const stackInstance = instantiateExecutionStack(executionStack);
  const driverDescriptor = executionStack.driver;
  if (!driverDescriptor) {
    throw new Error('Driver descriptor missing from execution stack');
  }
  const driver = driverDescriptor.create({
    connect: { pool },
    cursor: { disabled: true },
  });

  return createRuntime({
    stackInstance,
    context: executionContext,
    driver,
    verify: {
      mode: 'onFirstUse',
      requireMarker: false,
    },
    plugins,
  });
}
