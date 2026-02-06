/**
 * Dynamic Runtime Wiring (Emitted Contract Workflow)
 *
 * This module handles all runtime instantiation: stack instantiation,
 * driver construction, and runtime creation. It imports static setup
 * from context.ts and adds only the dynamic parts.
 */
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

  const stackInstance = instantiateExecutionStack(executionStack);
  const driver = executionStack.driver!.create({
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
