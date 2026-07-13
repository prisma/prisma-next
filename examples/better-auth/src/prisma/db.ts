import betterAuthRuntimeDescriptor from '@prisma-next/extension-better-auth/runtime';
import postgres from '@prisma-next/postgres/runtime';
import { Pool } from 'pg';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export type Db = ReturnType<typeof postgres<Contract>>;

export interface AppDb {
  /** The app's client over its aggregate contract (`Profile`, …). */
  readonly db: Db;
  /**
   * The shared connection pool — hand it to `prismaNextAdapter({ pg })`,
   * which builds its own space-scoped view over it internally.
   */
  readonly pool: Pool;
  close(): Promise<void>;
}

/**
 * One client over the app's aggregate contract, on an app-owned pool.
 *
 * The aggregate records the better-auth pack requirement, so the pack's
 * `/runtime` descriptor is passed through the public `extensions` option
 * — without it, `postgres()` rejects the contract with "Contract requires
 * extension pack(s) 'better-auth', but runtime descriptors do not provide
 * matching component(s)."
 */
export function createAppDb(url: string): AppDb {
  const pool = new Pool({ connectionString: url });
  // pg emits 'error' on idle-client disconnects (pgbouncer restarts,
  // serverless Postgres reaping idle connections, network blips). Without
  // a listener the event crashes the whole Node process; the pool itself
  // replaces the dead client on the next checkout. Log and move on.
  pool.on('error', (err) => {
    console.error('pg pool error (idle client):', err.message);
  });

  const db = postgres<Contract>({
    contractJson,
    pg: pool,
    extensions: [betterAuthRuntimeDescriptor],
  });

  return {
    db,
    pool,
    async close() {
      await pool.end();
    },
  };
}
