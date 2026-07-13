/**
 * End-to-end proof of the README's story against a dev database:
 *
 * 1. README step fidelity — `contract emit` reproduces the committed
 *    aggregate byte-for-byte (drift tripwire), the committed migrations
 *    (app space + seeded better-auth space) pass offline integrity, and
 *    `db init` walks both spaces on a fresh database.
 * 2. Cross-space FK — `db init` created `profile` with a real cascading
 *    FK onto `"public"."user"(id)`.
 * 3. The consumer flow — sign-up through the real HTTP server, an
 *    authenticated request reading the session via BetterAuth, and the
 *    `Profile → user` ORM join through the aggregate client.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadContractSpaceAggregate } from '@prisma-next/migration-tools/aggregate';
import { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { join } from 'pathe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '../src/auth';
import { type AppDb, createAppDb } from '../src/prisma/db';
import { createAppServer } from '../src/server';

const execFileAsync = promisify(execFile);
const EXAMPLE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONTRACT_JSON_PATH = join(EXAMPLE_ROOT, 'src', 'prisma', 'contract.json');

const serializer = new PostgresContractSerializer();

let database: Awaited<ReturnType<typeof createDevDatabase>>;
let appDb: AppDb;
let baseUrl: string;
let server: ReturnType<typeof createAppServer>;

async function runCli(args: readonly string[]): Promise<void> {
  await execFileAsync('pnpm', ['exec', 'prisma-next', ...args], {
    cwd: EXAMPLE_ROOT,
    env: { ...process.env, DATABASE_URL: database.connectionString },
  });
}

beforeAll(async () => {
  database = await createDevDatabase();

  // README step 1 — `pnpm emit` is deterministic and matches the
  // committed aggregate (regenerating must be a no-op).
  const committedContract = readFileSync(CONTRACT_JSON_PATH, 'utf-8');
  await runCli(['contract', 'emit']);
  expect(readFileSync(CONTRACT_JSON_PATH, 'utf-8'), 'emit reproduces committed contract').toBe(
    committedContract,
  );

  // README step 3 — `db init` walks the app space and the seeded
  // better-auth space to head on a fresh database. (Step 2, `migration
  // plan`, produced the committed migrations; its output is validated
  // offline below rather than re-run, since planning at head is a no-op.)
  await runCli(['db', 'init']);

  appDb = createAppDb(database.connectionString);
  const auth = createAuth(appDb.authDb, { baseURL: 'http://localhost' });
  server = createAppServer(auth, appDb);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://localhost:${port}`;
}, timeouts.spinUpPpgDev);

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server ? server.close((err) => (err ? reject(err) : resolve())) : resolve(),
  );
  await appDb?.close();
  await database?.close();
}, timeouts.spinUpPpgDev);

describe('committed migration artifacts', () => {
  it('pass offline integrity for both spaces', async () => {
    const contractJson = JSON.parse(readFileSync(CONTRACT_JSON_PATH, 'utf-8'));
    const aggregate = await loadContractSpaceAggregate({
      migrationsDir: join(EXAMPLE_ROOT, 'migrations'),
      appContract: serializer.deserializeContract(contractJson),
      deserializeContract: (raw) => serializer.deserializeContract(raw),
    });

    const violations = aggregate.checkIntegrity({
      declaredExtensions: [{ id: 'better-auth', targetId: 'postgres' }],
      checkContracts: true,
    });
    expect(violations).toEqual([]);
  });
});

describe('cross-space FK in the live database', () => {
  it('profile carries a cascading FK onto "public"."user"(id)', async () => {
    const rows = await withClient(database.connectionString, async (client) => {
      const result = await client.query(
        `SELECT confrel.relname AS references_table, con.confdeltype::text AS on_delete
           FROM pg_constraint con
           JOIN pg_class rel ON rel.oid = con.conrelid
           JOIN pg_class confrel ON confrel.oid = con.confrelid
          WHERE rel.relname = 'profile' AND con.contype = 'f'`,
      );
      return result.rows;
    });
    expect(rows).toEqual([{ references_table: 'user', on_delete: 'c' }]);
  });
});

describe('authenticated flow over the HTTP server', () => {
  it('rejects an unauthenticated /api/me request', {
    timeout: timeouts.databaseOperation,
  }, async () => {
    const response = await fetch(`${baseUrl}/api/me`);
    expect(response.status).toBe(401);
  });

  it('signs up, reads the session, and joins Profile → user', {
    timeout: timeouts.databaseOperation,
  }, async () => {
    // Sign-up through BetterAuth's own HTTP handler.
    const signUp = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'ada@example.com',
        password: 'correct-horse-battery-staple',
        name: 'Ada Lovelace',
      }),
    });
    expect(signUp.status).toBe(200);
    const cookie = signUp.headers.get('set-cookie');
    expect(cookie).toBeTruthy();
    const signUpBody = (await signUp.json()) as { user: { id: string } };
    const userId = signUpBody.user.id;

    // The app creates its own Profile row for the new user.
    await appDb.db.orm.public.Profile.create({
      id: 'profile-ada',
      bio: 'first programmer',
      userId,
    });

    // Authenticated request: session via BetterAuth, Profile → user join
    // via the ORM.
    const me = await fetch(`${baseUrl}/api/me`, {
      headers: { cookie: cookie ?? '' },
    });
    expect(me.status).toBe(200);
    const body = (await me.json()) as {
      session: { userId: string };
      profile: {
        id: string;
        bio: string;
        userId: string;
        user: { id: string; name: string; email: string };
      };
    };
    expect(body.session.userId).toBe(userId);
    expect(body.profile.id).toBe('profile-ada');
    expect(body.profile.bio).toBe('first programmer');
    expect(body.profile.user.id).toBe(userId);
    expect(body.profile.user.name).toBe('Ada Lovelace');
    expect(body.profile.user.email).toBe('ada@example.com');
  });

  it('cascades profile deletion when the user is deleted', {
    timeout: timeouts.databaseOperation,
  }, async () => {
    const before = await appDb.db.orm.public.Profile.where({ id: 'profile-ada' }).first();
    expect(before).not.toBeNull();

    await appDb.authDb.orm.public.User.where({ email: 'ada@example.com' }).delete();

    const after = await appDb.db.orm.public.Profile.where({ id: 'profile-ada' }).first();
    expect(after).toBeNull();
  });
});
