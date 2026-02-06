import { budgets, createRuntime, type Plugin, type Runtime } from '@prisma-next/sql-runtime';
import { executionContext, executionStackInstance } from './execution-context';

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
    plugins,
  });
}
