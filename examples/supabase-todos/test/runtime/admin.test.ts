/**
 * Smoke tests for the admin Prisma Next runtime (T1.9).
 *
 * Lands in `phase-1d` ahead of T1.8's implementation, so the commit
 * history records tests-first ordering (R-NF-4). Until `src/server/db.ts`
 * exists, the import below fails and the suite is red — which is
 * exactly what tests-first wants.
 *
 * What this verifies
 * ------------------
 * The admin runtime in `examples/supabase-todos/src/server/db.ts` is
 * the first PN runtime in this example. It binds to the local Supabase
 * Postgres direct URL with the `postgres` superuser, which bypasses
 * RLS — appropriate for migrations / seeds / admin tools, *never* for
 * request handlers (M2's territory).
 *
 * The suite asserts:
 *   - PN can read the seed fixtures end-to-end (contract → planner →
 *     adapter → driver → live database → decoded rows) when RLS is
 *     bypassed.
 *   - The decoded row shapes line up with the contract's emitted
 *     `FieldOutputTypes` (one `satisfies` per table; the vitest spec
 *     [§ T1.9](../../../../projects/supabase-poc/plan.md) accepts
 *     `expectTypeOf` / `assertType` / a manual `satisfies` for this
 *     leg). Storage column names are snake_case (per
 *     `naming: { columns: 'snake_case' }` on the contract), so the
 *     row keys here are snake_case too.
 *
 * It is the baseline before M2 layers RLS-scoped runtimes on. Cross-
 * contamination tests (RLS actually filtering) live in `phase-2`'s
 * `test/runtime/factory.test.ts`.
 *
 * Environment
 * -----------
 *   DATABASE_URL  Direct (non-pooled) Postgres URL for the local
 *                 Supabase stack. Defaults match `.env.example`:
 *                 `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
 *                 Loaded from `.env` via `dotenv/config` so a fresh
 *                 `pnpm --filter supabase-todos test` works after
 *                 the standard setup sequence.
 *
 * Preconditions
 * -------------
 *   1. `supabase start` is running locally.
 *   2. `pnpm --filter supabase-todos migrate:up` has been run.
 *   3. `pnpm --filter supabase-todos seed` has been run.
 *
 * If `DATABASE_URL` is missing the suite is skipped (CI without the
 * local stack should not false-fail).
 */
import 'dotenv/config';
import type { Runtime } from '@prisma-next/sql-runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AdminDb, createAdminDb } from '../../src/server/db';

const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)('admin runtime (T1.9)', () => {
  let db: AdminDb;
  let runtime: Runtime;

  beforeAll(async () => {
    if (!databaseUrl) {
      // describe.skipIf above already short-circuits; this narrows for TS.
      throw new Error('DATABASE_URL must be set to run admin runtime smoke tests');
    }
    db = createAdminDb(databaseUrl);
    runtime = await db.connect();
  });

  afterAll(async () => {
    if (runtime) {
      await runtime.close();
    }
  });

  it('reads all profiles (RLS bypassed → 2 rows)', async () => {
    const plan = db.sql.profiles.select('id', 'email', 'display_name', 'created_at').build();
    const rows = await runtime.execute(plan);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.email).sort()).toEqual(['alice@example.test', 'bob@example.test']);

    const [row] = rows;
    if (!row) throw new Error('expected at least one profile');
    row satisfies {
      id: string;
      email: string;
      display_name: string | null;
      created_at: string | Date;
    };
  });

  it('reads all todos (RLS bypassed → 5 rows)', async () => {
    const plan = db.sql.todos.select('id', 'user_id', 'title', 'completed').build();
    const rows = await runtime.execute(plan);

    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.title).sort()).toEqual([
      'Read the spec',
      'Review the plan',
      'Ship the PoC',
      'Test RLS',
      'Write the spec',
    ]);

    const [row] = rows;
    if (!row) throw new Error('expected at least one todo');
    row satisfies {
      id: string;
      user_id: string;
      title: string;
      completed: boolean;
    };
  });

  it('reads all public_messages (RLS bypassed → 2 rows)', async () => {
    const plan = db.sql.public_messages.select('id', 'author_id', 'body').build();
    const rows = await runtime.execute(plan);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.body).sort()).toEqual(['Bob says hi', 'Hello world from Alice']);

    const [row] = rows;
    if (!row) throw new Error('expected at least one public_message');
    row satisfies {
      id: string;
      author_id: string;
      body: string;
    };
  });
});
