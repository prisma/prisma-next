/**
 * Slice D — service_role queries Supabase-internal namespaces via the facade.
 *
 * Proves the core claim of Slice D:
 *
 *   `db.asServiceRole().sql` exposes the `auth` and `storage` namespaces
 *   alongside the app's own namespaces. `asAnon()` and `asUser(jwt)` expose
 *   only the app contract's namespaces.
 *
 * Assertions:
 *
 *   1. `db.asServiceRole().sql.auth.users.select(…)` returns a seeded row and
 *      the emitted SQL targets `"auth"."users"`; the bound connection runs as
 *      `service_role` (read via `current_setting('role')`), proving it is the
 *      role grants — not the pool owner — that authorise the read.
 *   2. `asServiceRole().sql` still exposes the app's own namespaces alongside
 *      `auth` / `storage` (non-regression).
 *
 * The compile-time side (asAnon/asUser expose no `.auth` / `.storage`) lives in
 * `service-role-namespaces.test-d.ts`.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { createControlClient } from '@prisma-next/cli/control-api';
import postgresDriver from '@prisma-next/driver-postgres/control';
import supabasePack from '@prisma-next/extension-supabase/pack';
import sql from '@prisma-next/family-sql/control';
import { emitContractSpaceArtefacts } from '@prisma-next/migration-tools/spaces';
import type { SqlMiddleware } from '@prisma-next/sql-runtime';
import postgres from '@prisma-next/target-postgres/control';
import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import contractJson from '../src/contract.json' with { type: 'json' };
import { createDb } from '../src/prisma/db';
import { bootstrapSupabaseShim } from './supabase-bootstrap';

function recordingMiddleware(): { middleware: SqlMiddleware; sqls: string[] } {
  const sqls: string[] = [];
  const middleware: SqlMiddleware = {
    name: 'sql-recorder',
    familyId: 'sql',
    async beforeExecute(plan) {
      sqls.push(plan.sql);
    },
  };
  return { middleware, sqls };
}

async function runDbInit(connectionString: string, migrationsDir: string): Promise<void> {
  const space = supabasePack.contractSpace;
  if (!space) throw new Error('supabasePack must declare a contractSpace');

  await emitContractSpaceArtefacts(migrationsDir, 'supabase', {
    contract: space.contractJson,
    contractDts: '// supabase extension contract space\n',
    headRef: { hash: space.headRef.hash, invariants: [...space.headRef.invariants] },
  });

  const client = createControlClient({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: [supabasePack],
  });

  try {
    await client.connect(connectionString);
    const result = await client.dbInit({ contract: contractJson, mode: 'apply', migrationsDir });
    if (!result.ok) throw new Error(`dbInit apply failed: ${result.failure.summary}`);
  } finally {
    await client.close();
  }
}

describe('Slice D — service_role queries auth/storage namespaces via the facade', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let migrationsDir: string;

  beforeEach(async () => {
    database = await createDevDatabase();
    migrationsDir = await mkdtemp(join(tmpdir(), 'supabase-sliced-migrations-'));
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (database) await database.close();
    if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
  }, timeouts.spinUpPpgDev);

  it(
    'asServiceRole().sql.auth.users returns seeded row; emitted SQL targets auth.users',
    async () => {
      const { connectionString } = database;

      await withClient(connectionString, async (pg) => {
        await bootstrapSupabaseShim(pg);
      });
      await runDbInit(connectionString, migrationsDir);

      await withClient(connectionString, async (pg) => {
        await pg.query(
          'GRANT USAGE ON SCHEMA _prisma_dev_wal TO anon, authenticated, service_role',
        );
        await pg.query(
          'GRANT ALL ON ALL TABLES IN SCHEMA _prisma_dev_wal TO anon, authenticated, service_role',
        );
        await pg.query(
          'GRANT ALL ON ALL SEQUENCES IN SCHEMA _prisma_dev_wal TO anon, authenticated, service_role',
        );
        await pg.query(
          'GRANT EXECUTE ON FUNCTION _prisma_dev_wal.capture_event() TO anon, authenticated, service_role',
        );
      });

      const userId = crypto.randomUUID();
      const now = new Date().toISOString();

      await withClient(connectionString, async (pg) => {
        await pg.query(
          'INSERT INTO auth.users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3)',
          [userId, 'admin@example.com', now],
        );
      });

      const recorder = recordingMiddleware();
      const db = await createDb(connectionString, { middleware: [recorder.middleware] });

      try {
        const sr = db.asServiceRole();

        // Runtime query: read auth.users via the facade
        const rows = await sr
          .execute(
            sr.sql.auth.users
              .select('id', 'email')
              .where((f, fns) => fns.eq(f.id, userId))
              .build(),
          )
          .toArray();

        expect(rows).toEqual([{ id: userId, email: 'admin@example.com' }]);

        // The emitted SQL must reference "auth"."users"
        const authQuery = recorder.sqls.find((s) => s.includes('"auth"') && s.includes('"users"'));
        expect(
          authQuery,
          `Expected a SQL query targeting "auth"."users"; saw: ${JSON.stringify(recorder.sqls)}`,
        ).toBeDefined();

        // Pin the bound role: the connection that read auth.users must run as
        // service_role, not as the pool's owner/superuser (which would also have
        // had grants and passed the read above). This is the security boundary.
        const [boundRole] = await sr
          .execute(
            sr.sql.auth.users
              .select('role', (_f, fns) => fns.raw`current_setting('role')`.returns('pg/text@1'))
              .where((f, fns) => fns.eq(f.id, userId))
              .build(),
          )
          .toArray();
        expect(boundRole).toEqual({ role: 'service_role' });
      } finally {
        await db.close();
      }
    },
    timeouts.spinUpPpgDev * 4,
  );

  it(
    'asServiceRole().sql still exposes app-contract namespaces alongside auth/storage',
    async () => {
      const { connectionString } = database;

      await withClient(connectionString, async (pg) => {
        await bootstrapSupabaseShim(pg);
      });
      await runDbInit(connectionString, migrationsDir);

      await withClient(connectionString, async (pg) => {
        await pg.query(
          'GRANT USAGE ON SCHEMA _prisma_dev_wal TO anon, authenticated, service_role',
        );
        await pg.query(
          'GRANT ALL ON ALL TABLES IN SCHEMA _prisma_dev_wal TO anon, authenticated, service_role',
        );
        await pg.query(
          'GRANT ALL ON ALL SEQUENCES IN SCHEMA _prisma_dev_wal TO anon, authenticated, service_role',
        );
        await pg.query(
          'GRANT EXECUTE ON FUNCTION _prisma_dev_wal.capture_event() TO anon, authenticated, service_role',
        );
      });

      const userId = crypto.randomUUID();
      const now = new Date().toISOString();

      await withClient(connectionString, async (pg) => {
        await pg.query(
          'INSERT INTO auth.users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3)',
          [userId, 'admin@example.com', now],
        );
      });

      const db = await createDb(connectionString);

      try {
        const sr = db.asServiceRole();

        // App-contract namespace still accessible
        await sr.execute(sr.sql.public.profile.select('id').build()).toArray();

        // Extension namespace accessible alongside
        const authRows = await sr.execute(sr.sql.auth.users.select('email').build()).toArray();

        expect(authRows.some((r) => r.email === 'admin@example.com')).toBe(true);
      } finally {
        await db.close();
      }
    },
    timeouts.spinUpPpgDev * 4,
  );
});
// Type-level assertions for the role-bound namespace surface (asServiceRole gains
// auth/storage; asAnon/asUser do not) live in service-role-namespaces.test-d.ts,
// typed with this example's app contract. The anon "no .auth accessor" guarantee
// is a compile-time boundary (anon's runtime lowers against the app contract,
// which has no auth schema), so it is proven there rather than at runtime.
