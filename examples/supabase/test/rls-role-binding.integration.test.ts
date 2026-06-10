/**
 * RLS-through-ORM acceptance test — role-bound Supabase runtime proven in the walking skeleton.
 *
 * Proves that the `supabase()` factory correctly enforces Postgres RLS via role bindings:
 *
 *   1. `asUser(jwt)` with a valid HS256 JWT for user A returns exactly user A's profile row
 *      through the ORM, filtered by the `profile_owner_select` RLS policy.
 *   2. `asAnon()` returns zero rows — RLS default-deny with no anon policy.
 *   3. `asServiceRole()` returns both profiles — BYPASSRLS skips all policies.
 *   4. The recording middleware captures only typed ORM queries, never `set_config` calls
 *      (proving `set_config` runs below the user middleware chain).
 *   5. An expired JWT → `InvalidJwtError`.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { createControlClient } from '@prisma-next/cli/control-api';
import postgresDriver from '@prisma-next/driver-postgres/control';
import supabasePack from '@prisma-next/extension-supabase/pack';
import { InvalidJwtError, supabase } from '@prisma-next/extension-supabase/runtime';
import sql from '@prisma-next/family-sql/control';
import { emitContractSpaceArtefacts } from '@prisma-next/migration-tools/spaces';
import type { SqlMiddleware } from '@prisma-next/sql-runtime';
import postgres from '@prisma-next/target-postgres/control';
import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Contract } from '../src/contract';
import contractJson from '../src/contract.json' with { type: 'json' };
import { bootstrapSupabaseShim } from './supabase-bootstrap';

const TEST_JWT_SECRET = 'supabase-test-secret-that-is-long-enough-for-hs256';

async function signJwt(
  payload: Record<string, unknown>,
  secret = TEST_JWT_SECRET,
  expiresIn = '1h',
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresIn)
    .sign(key);
}

function recordingMiddleware(): { middleware: SqlMiddleware; sqls: string[] } {
  const sqls: string[] = [];
  const middleware: SqlMiddleware = {
    name: 'rls-recorder',
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
    if (!result.ok) {
      throw new Error(`dbInit apply failed: ${result.failure.summary}`);
    }
  } finally {
    await client.close();
  }
}

async function applyRlsFixture(connectionString: string): Promise<void> {
  await withClient(connectionString, async (pg) => {
    // Roles
    await pg.query('CREATE ROLE anon NOLOGIN');
    await pg.query('CREATE ROLE authenticated NOLOGIN');
    await pg.query('CREATE ROLE service_role NOLOGIN BYPASSRLS');
    await pg.query('GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role');
    await pg.query('GRANT SELECT ON public.profile TO anon, authenticated');
    await pg.query('GRANT ALL ON public.profile TO service_role');

    // RLS
    await pg.query('ALTER TABLE public.profile ENABLE ROW LEVEL SECURITY');
    await pg.query(`
      CREATE POLICY profile_owner_select ON public.profile FOR SELECT TO authenticated
        USING ("userId" = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid)
    `);
  });
}

describe('RLS — role-bound Supabase runtime acceptance', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let migrationsDir: string;

  beforeEach(async () => {
    database = await createDevDatabase();
    migrationsDir = await mkdtemp(join(tmpdir(), 'supabase-rls-migrations-'));
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (database) await database.close();
    if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
  }, timeouts.spinUpPpgDev);

  it(
    'asUser returns only owner row; asAnon returns 0; asServiceRole returns all; set_config invisible to middleware',
    async () => {
      const { connectionString } = database;

      // Seed external schema shim (auth.users etc.) + apply public.profile DDL.
      await withClient(connectionString, async (pg) => {
        await bootstrapSupabaseShim(pg);
      });
      await runDbInit(connectionString, migrationsDir);
      await applyRlsFixture(connectionString);

      // Seed two auth users + two profiles via raw SQL (service_role write path proven later).
      const userAId = crypto.randomUUID();
      const userBId = crypto.randomUUID();
      const profileAId = crypto.randomUUID();
      const profileBId = crypto.randomUUID();
      const now = new Date().toISOString();

      await withClient(connectionString, async (pg) => {
        await pg.query(
          'INSERT INTO auth.users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3), ($4, $5, $3, $3)',
          [userAId, 'user-a@example.com', now, userBId, 'user-b@example.com'],
        );
        // Use quoted "userId" — the contract maps userId field to the "userId" column.
        await pg.query(
          'INSERT INTO public.profile (id, username, "userId") VALUES ($1, $2, $3), ($4, $5, $6)',
          [profileAId, 'alice', userAId, profileBId, 'bob', userBId],
        );
      });

      const recorder = recordingMiddleware();

      const db = await supabase<Contract>({
        contractJson,
        url: connectionString,
        jwtSecret: TEST_JWT_SECRET,
        middleware: [recorder.middleware],
        verifyMarker: false,
      });

      try {
        // --- asUser: sees only user A's profile ---
        const jwtA = await signJwt({ sub: userAId, role: 'authenticated' });
        const userADb = await db.asUser(jwtA);
        const userARows = await userADb.orm.public.Profile.select('id', 'username', 'userId')
          .all()
          .toArray();

        expect(userARows).toEqual([{ id: profileAId, username: 'alice', userId: userAId }]);

        // --- asAnon: no policy → zero rows ---
        const anonRows = await db
          .asAnon()
          .orm.public.Profile.select('id', 'username', 'userId')
          .all()
          .toArray();

        expect(anonRows).toEqual([]);

        // --- asServiceRole: BYPASSRLS → both rows ---
        const serviceRows = await db
          .asServiceRole()
          .orm.public.Profile.select('id', 'username', 'userId')
          .all()
          .toArray();

        // Sort by username for deterministic assertion.
        const sortedServiceRows = [...serviceRows].sort((a, b) =>
          a.username.localeCompare(b.username),
        );
        expect(sortedServiceRows).toEqual([
          { id: profileAId, username: 'alice', userId: userAId },
          { id: profileBId, username: 'bob', userId: userBId },
        ]);

        // --- set_config invisible to middleware ---
        const setConfigInMiddleware = recorder.sqls.some((s) => s.includes('set_config'));
        expect(setConfigInMiddleware, 'set_config must not appear in middleware-visible SQL').toBe(
          false,
        );
        // Middleware must have seen at least one SELECT (the ORM queries above).
        expect(recorder.sqls.length, 'middleware must have captured ORM queries').toBeGreaterThan(
          0,
        );
      } finally {
        await db.close();
      }
    },
    timeouts.spinUpPpgDev * 4,
  );

  it(
    'asUser rejects an expired JWT with InvalidJwtError',
    async () => {
      const { connectionString } = database;

      await withClient(connectionString, async (pg) => {
        await bootstrapSupabaseShim(pg);
      });
      await runDbInit(connectionString, migrationsDir);

      const db = await supabase<Contract>({
        contractJson,
        url: connectionString,
        jwtSecret: TEST_JWT_SECRET,
        verifyMarker: false,
      });

      try {
        const expiredJwt = await signJwt(
          { sub: crypto.randomUUID(), role: 'authenticated' },
          TEST_JWT_SECRET,
          '-1s',
        );
        await expect(db.asUser(expiredJwt)).rejects.toThrow(InvalidJwtError);
      } finally {
        await db.close();
      }
    },
    timeouts.spinUpPpgDev * 4,
  );
});
