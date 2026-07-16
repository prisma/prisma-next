/**
 * Shared Supabase test fixture — restores the full reference schema with
 * the real instance's privileges, and nothing else.
 *
 * Seeds a Postgres/PGlite database with the Supabase reference fixture
 * (`test/fixtures/supabase-reference/` — every schema, table, native enum,
 * role, GRANT, and ALTER DEFAULT PRIVILEGES a real Supabase instance ships,
 * captured from a live local stack) via `restoreSupabaseReference`. The
 * composed contract declares `auth.*` and `storage.*` tables as `external`,
 * and the framework verifier confirms every declared `external` table
 * exists — restoring the full reference fixture (33 tables) rather than a
 * hand-picked few is what keeps that check satisfiable regardless of which
 * tables a given contract declares.
 *
 * The shim's job is fidelity to a fresh `supabase db reset`: it adds no
 * grants of its own. RLS is enforced by policies AND grants, so a shim
 * database more permissive than a real project would let tests pass that
 * fail in production (and did — see TML-3035 findings §6/§8).
 *
 * The caller owns the client lifecycle — pass any already-connected `pg.Client`
 * (e.g. one the test is sharing across setup steps, or one bound to a
 * transaction for isolation). Convenience wrapper for tests that don't already
 * have one:
 *
 * In-repo test tooling only — not part of the published package surface
 * (the fixture `.sql` files it reads are not shipped). Tests import it by
 * source path.
 *
 * @example
 * ```ts
 * import { withClient } from '@prisma-next/test-utils';
 * import { bootstrapSupabaseShim } from './supabase-bootstrap';
 *
 * await withClient(connectionString, async (client) => {
 *   await bootstrapSupabaseShim(client);
 * });
 * ```
 */
import type { Client } from 'pg';
import { restoreSupabaseReference } from './fixtures/supabase-reference/restore';

/**
 * Restores the Supabase reference fixture — schemas, tables, roles, and the
 * real instance's privileges. The caller passes an already-connected
 * `pg.Client` — this function does not open or close connections.
 */
export async function bootstrapSupabaseShim(client: Client): Promise<void> {
  // The fixture carries the real instance's GRANT / ALTER DEFAULT PRIVILEGES
  // statements verbatim, so the restored database has exactly the privileges
  // a fresh `supabase db reset` produces. Notably that means `service_role`
  // has NO table privileges on `auth.*` (only schema USAGE) — a test that
  // exercises the `.supabase` admin root must issue the narrow grant it
  // needs in its own setup (e.g. `GRANT SELECT ON TABLE auth.users TO
  // service_role`), the same grant a real project requires. Tables an app
  // contract creates in `public` afterwards (e.g. via dbInit) pick up the
  // platform roles' access through the fixture's default privileges for the
  // `postgres` role — the role tests connect as.
  await restoreSupabaseReference(client);
}
