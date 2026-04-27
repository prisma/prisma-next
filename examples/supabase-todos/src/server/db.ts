/**
 * Admin Prisma Next runtime (T1.8).
 *
 * Plain PN client bound to the local Supabase Postgres direct URL.
 * The connection uses the `postgres` superuser, which **bypasses
 * RLS** — appropriate for migrations, the seed script, and any
 * admin / maintenance task that needs unconditional access. It is
 * **not** appropriate for request handlers; per-request isolation
 * is the job of the scoped runtime factory landing in M2
 * (`src/server/supabase-runtime.ts`).
 *
 * Why mirror `examples/prisma-next-demo/src/prisma/db.ts`?
 *  - This example exists to show that PN works on Supabase Postgres
 *    *exactly as it does anywhere else*. The admin surface should
 *    therefore be the same factory call as the canonical demo, just
 *    pointed at the local Supabase direct URL. Anything Supabase-
 *    specific lives in M2 / M4.
 *
 * Why a factory and not a module-level singleton?
 *  - Tests construct a runtime against `process.env['DATABASE_URL']`
 *    inside `beforeAll`; if the URL were read at module-load time
 *    the test would have to fight import order and `dotenv`
 *    initialisation. A factory keeps the connection-string read at
 *    the call site.
 *  - The seed script (`scripts/seed.ts`) currently uses
 *    `@supabase/supabase-js` directly rather than this runtime — see
 *    its docblock — but if we later refactor it to go through PN,
 *    the same factory plugs in unchanged.
 *
 * @see projects/supabase-poc/plan.md § Milestone 1, T1.8
 * @see projects/supabase-poc/skills/writing-rls-policies-with-pn/SKILL.md § 5
 */
import postgres from '@prisma-next/postgres/runtime';
import type { Contract } from '../db/contract.d';
import contractJson from '../db/contract.json' with { type: 'json' };

export function createAdminDb(connectionString: string) {
  return postgres<Contract>({
    contractJson,
    url: connectionString,
  });
}

export type AdminDb = ReturnType<typeof createAdminDb>;
