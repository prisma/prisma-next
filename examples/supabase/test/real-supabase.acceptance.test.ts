/**
 * Real-Supabase acceptance test — the real-connection variant of
 * `rls-role-binding.integration.test.ts`. Runs the same RLS role-binding
 * flows against a live Supabase Postgres instead of PGlite.
 *
 * Skipped (green) unless both `DATABASE_URL` (a direct, service_role-capable
 * connection to a real Supabase project) and `SUPABASE_JWT_SECRET` (the
 * project's JWT secret) are set, so it never runs on the normal CI path.
 * See `examples/supabase/README.md` for how to run it.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { createControlClient } from '@prisma-next/cli/control-api';
import postgresDriver from '@prisma-next/driver-postgres/control';
import supabasePack from '@prisma-next/extension-supabase/pack';
import { InvalidJwtError } from '@prisma-next/extension-supabase/runtime';
import sql from '@prisma-next/family-sql/control';
import { emitContractSpaceArtefacts } from '@prisma-next/migration-tools/spaces';
import type { SqlMiddleware } from '@prisma-next/sql-runtime';
import postgres from '@prisma-next/target-postgres/control';
import { timeouts, withClient } from '@prisma-next/test-utils';
import { SignJWT } from 'jose';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import contractJson from '../src/contract.json' with { type: 'json' };
import { createDb } from '../src/prisma/db';

function requireEnv(name: 'DATABASE_URL' | 'SUPABASE_JWT_SECRET'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set — describe.skipIf should have skipped this suite`);
  }
  return value;
}

async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
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

// A real Supabase project already has anon/authenticated/service_role and the
// auth/storage grants bootstrapSupabaseShim fabricates for PGlite — only the
// app-table grants dbInit's plan doesn't cover are needed here.
async function applyProfileGrants(connectionString: string): Promise<void> {
  await withClient(connectionString, async (pg) => {
    await pg.query('GRANT SELECT ON public.profile TO anon, authenticated');
    await pg.query('GRANT ALL ON public.profile TO service_role');
    await pg.query('GRANT INSERT ON public.profile TO service_role');
    await pg.query('GRANT UPDATE ON public.profile TO authenticated');
  });
}

describe.skipIf(!process.env['DATABASE_URL'] || !process.env['SUPABASE_JWT_SECRET'])(
  'RLS — role-bound Supabase runtime acceptance (real Supabase)',
  () => {
    let connectionString: string;
    let jwtSecret: string;
    let migrationsDir: string;

    beforeEach(async () => {
      connectionString = requireEnv('DATABASE_URL');
      jwtSecret = requireEnv('SUPABASE_JWT_SECRET');
      migrationsDir = await mkdtemp(join(tmpdir(), 'supabase-rls-acceptance-'));
    }, timeouts.spinUpPpgDev);

    afterEach(async () => {
      if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
    }, timeouts.spinUpPpgDev);

    it(
      'asUser returns only owner row; asAnon returns all (public-read policy); asServiceRole returns all; set_config invisible to middleware',
      async () => {
        await runDbInit(connectionString, migrationsDir);
        await applyProfileGrants(connectionString);

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
          await pg.query(
            'INSERT INTO public.profile (id, username, "userId") VALUES ($1, $2, $3), ($4, $5, $6)',
            [profileAId, 'alice', userAId, profileBId, 'bob', userBId],
          );
        });

        try {
          const recorder = recordingMiddleware();
          const db = await createDb(connectionString, { middleware: [recorder.middleware] });

          try {
            const jwtA = await signJwt({ sub: userAId, role: 'authenticated' }, jwtSecret);
            const userADb = await db.asUser(jwtA);
            const userARows = await userADb.orm.public.Profile.select('id', 'username', 'userId')
              .all()
              .toArray();

            expect(userARows).toEqual([{ id: profileAId, username: 'alice', userId: userAId }]);

            const anonRows = await db
              .asAnon()
              .orm.public.Profile.select('id', 'username', 'userId')
              .all()
              .toArray();

            const sortedAnonRows = [...anonRows].sort((a, b) =>
              a.username.localeCompare(b.username),
            );
            expect(sortedAnonRows).toEqual([
              { id: profileAId, username: 'alice', userId: userAId },
              { id: profileBId, username: 'bob', userId: userBId },
            ]);

            const serviceRows = await db
              .asServiceRole()
              .orm.public.Profile.select('id', 'username', 'userId')
              .all()
              .toArray();

            const sortedServiceRows = [...serviceRows].sort((a, b) =>
              a.username.localeCompare(b.username),
            );
            expect(sortedServiceRows).toEqual([
              { id: profileAId, username: 'alice', userId: userAId },
              { id: profileBId, username: 'bob', userId: userBId },
            ]);

            const setConfigInMiddleware = recorder.sqls.some((s) => s.includes('set_config'));
            expect(
              setConfigInMiddleware,
              'set_config must not appear in middleware-visible SQL',
            ).toBe(false);
            expect(
              recorder.sqls.length,
              'middleware must have captured ORM queries',
            ).toBeGreaterThan(0);
          } finally {
            await db.close();
          }
        } finally {
          await withClient(connectionString, async (pg) => {
            await pg.query('DELETE FROM auth.users WHERE id IN ($1, $2)', [userAId, userBId]);
          });
        }
      },
      timeouts.spinUpPpgDev * 4,
    );

    it(
      'asServiceRole ORM create succeeds; asUser ORM update scoped to own row; update against other row affects 0; withCheck rejects reassignment to another owner',
      async () => {
        await runDbInit(connectionString, migrationsDir);
        await applyProfileGrants(connectionString);

        const userAId = crypto.randomUUID();
        const userBId = crypto.randomUUID();
        const now = new Date().toISOString();

        await withClient(connectionString, async (pg) => {
          await pg.query(
            'INSERT INTO auth.users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3), ($4, $5, $3, $3)',
            [userAId, 'user-a@example.com', now, userBId, 'user-b@example.com'],
          );
        });

        try {
          const db = await createDb(connectionString);

          try {
            const created = await db.asServiceRole().orm.public.Profile.createCount([
              { userId: userAId, username: 'alice' },
              { userId: userBId, username: 'bob' },
            ]);
            expect(created).toBe(2);

            const allRows = await db
              .asServiceRole()
              .orm.public.Profile.select('username', 'userId')
              .all()
              .toArray();
            const sorted = [...allRows].sort((a, b) => a.username.localeCompare(b.username));
            expect(sorted).toEqual([
              { username: 'alice', userId: userAId },
              { username: 'bob', userId: userBId },
            ]);

            const jwtA = await signJwt({ sub: userAId, role: 'authenticated' }, jwtSecret);
            const userADb = await db.asUser(jwtA);
            const updatedCount = await userADb.orm.public.Profile.where({
              userId: userAId,
            }).updateCount({ username: 'alice-updated' });
            expect(updatedCount).toBe(1);

            const crossUpdatedCount = await userADb.orm.public.Profile.where({
              userId: userBId,
            }).updateCount({ username: 'should-not-change' });
            expect(crossUpdatedCount).toBe(0);

            const bobRows = await db
              .asServiceRole()
              .orm.public.Profile.select('username', 'userId')
              .where({ userId: userBId })
              .all()
              .toArray();
            expect(bobRows).toEqual([{ username: 'bob', userId: userBId }]);

            await expect(
              userADb.orm.public.Profile.where({ userId: userAId }).updateCount({
                userId: userBId,
              }),
            ).rejects.toThrow(/row-level security/);
          } finally {
            await db.close();
          }
        } finally {
          await withClient(connectionString, async (pg) => {
            await pg.query('DELETE FROM auth.users WHERE id IN ($1, $2)', [userAId, userBId]);
          });
        }
      },
      timeouts.spinUpPpgDev * 4,
    );

    it(
      'asUser rejects an expired JWT with InvalidJwtError',
      async () => {
        await runDbInit(connectionString, migrationsDir);

        const db = await createDb(connectionString);

        try {
          const expiredJwt = await signJwt(
            { sub: crypto.randomUUID(), role: 'authenticated' },
            jwtSecret,
            '-1s',
          );
          await expect(db.asUser(expiredJwt)).rejects.toThrow(InvalidJwtError);
        } finally {
          await db.close();
        }
      },
      timeouts.spinUpPpgDev * 4,
    );
  },
);
