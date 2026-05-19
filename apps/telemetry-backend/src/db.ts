import postgres from '@prisma-next/postgres/runtime';
import type { Contract } from './prisma/contract.d';
import contractJson from './prisma/contract.json' with { type: 'json' };

export type TelemetryDb = ReturnType<typeof createTelemetryDb>;

export function createTelemetryDb(url: string) {
  const db = postgres<Contract>({ contractJson, url });
  return {
    sql: db.sql,
    runtime: db.runtime,
    async close(): Promise<void> {
      await db.runtime().close();
    },
  };
}
