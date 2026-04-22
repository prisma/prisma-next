import postgres, { type PostgresClient } from '@prisma-next/postgres/runtime';
import { Pool } from 'pg';
import type { Contract } from '../../src/prisma/contract.d';
import contractJson from '../../src/prisma/contract.json' with { type: 'json' };

type Db = PostgresClient<Contract>;

let cached: { db: Db; pool: Pool } | undefined;

export function getDb(): Db {
  if (!cached) {
    // @prisma/dev (PGlite) rejects concurrent connections; cap the pool at 1 so the
    // smoke test harness stays compatible. One connection is enough for this example,
    // which runs requests serially in tests.
    const pool = new Pool({
      connectionString: process.env['DATABASE_URL'],
      max: 1,
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
// of reusing the stale one. APR-VP3-07 will replace this with hash-keyed caching.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (cached) {
      void cached.pool.end();
      cached = undefined;
    }
  });
}
