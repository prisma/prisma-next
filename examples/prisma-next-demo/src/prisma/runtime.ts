import { budgets, createRuntime, type Runtime } from '@prisma-next/sql-runtime';
import { Pool } from 'pg';
import { executionContext, executionStackInstance } from './query';
import { loadRuntimeConfig } from './runtime-config';

let runtime: Runtime | undefined;
let pool: Pool | undefined;

export function getRuntime(): Runtime {
  if (!runtime) {
    const { databaseUrl } = loadRuntimeConfig();
    pool = new Pool({ connectionString: databaseUrl });

    runtime = createRuntime({
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
  return runtime;
}

export async function closeRuntime() {
  if (runtime) {
    await runtime.close();
    runtime = undefined;
  }
  // Pool is closed by runtime.close() -> driver.close(), so we just clear the reference
  if (pool) {
    pool = undefined;
  }
}
