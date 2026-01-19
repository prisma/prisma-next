import { budgets, createRuntime, type Runtime } from '@prisma-next/sql-runtime';
import { Pool } from 'pg';
import { executionContext, executionStackInstance } from './query-no-emit';

export function getRuntime(databaseUrl: string): Runtime {
  const pool = new Pool({ connectionString: databaseUrl });

  return createRuntime({
    stack: executionStackInstance,
    contract: executionContext.contract,
    context: executionContext,
    driverOptions: {
      connect: { pool },
      cursor: { disabled: true },
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
