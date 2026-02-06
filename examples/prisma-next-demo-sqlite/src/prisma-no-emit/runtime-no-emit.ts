import { budgets, createRuntime, type Runtime } from '@prisma-next/sql-runtime';
import { executionContext, executionStackInstance } from './query-no-emit';

export function getRuntime(databaseUrl: string): Runtime {
  return createRuntime({
    stackInstance: executionStackInstance,
    contract: executionContext.contract,
    context: executionContext,
    driverOptions: {
      connect: { filename: databaseUrl },
    },
    verify: {
      mode: 'onFirstUse',
      requireMarker: false,
    },
    plugins: [
      budgets({
        maxRows: 10_000,
        defaultTableRows: 10_000,
        tableRows: { user: 10_000, post: 10_000 },
        maxLatencyMs: 1_000,
      }),
    ],
  });
}
