import postgres, { type PostgresClient } from '@prisma-next/postgres/runtime';
import { Pool } from 'pg';
import type { Contract } from '../../src/prisma/contract.d';
import contractJson from '../../src/prisma/contract.json' with { type: 'json' };

type Db = PostgresClient<Contract>;

let cached: { db: Db; pool: Pool } | undefined;

export function getDb(): Db {
  if (!cached) {
    // PRISMA_NEXT_DEMO_PG_POOL_MAX, when set, caps the pool size. The smoke
    // test sets it to '1' so the example cohabits with @prisma/dev (PGlite),
    // which rejects concurrent connections. In production the pg default
    // applies and the framework's own pool sizing wins.
    const poolMaxRaw = process.env['PRISMA_NEXT_DEMO_PG_POOL_MAX'];
    const pool = new Pool({
      connectionString: process.env['DATABASE_URL'],
      ...(poolMaxRaw === undefined ? {} : { max: Number(poolMaxRaw) }),
    });
    // pg emits 'error' on idle-client disconnects (e.g., the test harness
    // tearing down @prisma/dev while the pool is still around). Without a
    // listener these surface as uncaughtException. Log and move on.
    pool.on('error', (err) => {
      console.error('[react-router-demo] pg pool error:', err.message);
    });
    cached = {
      db: postgres<Contract>({ contractJson, pg: pool }),
      pool,
    };
  }
  return cached.db;
}

// Drop the cached client whenever Vite re-executes this module so HMR after a
// contract re-emit rebuilds the runtime against the fresh contractJson instead
// of reusing the stale one.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (cached) {
      void cached.pool.end();
      cached = undefined;
    }
  });
}
