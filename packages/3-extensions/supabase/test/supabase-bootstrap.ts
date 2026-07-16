/**
 * Shared Supabase test fixture — restores the full reference schema and
 * adds the app-facing grants a test database needs on top of it.
 *
 * Seeds a Postgres/PGlite database with the Supabase reference fixture
 * (`test/fixtures/supabase-reference/` — every schema, table, native enum,
 * and role a real Supabase instance ships, captured from a live local stack)
 * via `restoreSupabaseReference`. The composed contract declares `auth.*`
 * and `storage.*` tables as `external`, and the framework verifier confirms
 * every declared `external` table exists — restoring the full reference
 * fixture (33 tables) rather than a hand-picked few is what keeps that check
 * satisfiable regardless of which tables a given contract declares.
 *
 * `auth.uid()` and the native enum types (including `auth.aal_level`) ship
 * as part of the reference fixture itself, so this shim only adds what the
 * fixture doesn't and can't know about: grants for the `public` schema an
 * app contract populates after this shim runs (e.g. `public.profile` via
 * `dbInit`), including `ALTER DEFAULT PRIVILEGES` so newly created tables
 * pick up the same access automatically.
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
 * Restores the Supabase reference fixture, then grants the three platform
 * roles (`anon`, `authenticated`, `service_role`) access to `auth`/`storage`
 * and to whatever an app contract adds to `public` afterward. The caller
 * passes an already-connected `pg.Client` — this function does not open or
 * close connections.
 */
export async function bootstrapSupabaseShim(client: Client): Promise<void> {
  await restoreSupabaseReference(client);

  // Grants mirror a real Supabase database's platform-role access to the
  // schemas this pack's contract declares.
  await client.query('GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role');
  await client.query('GRANT USAGE ON SCHEMA auth, storage TO anon, authenticated, service_role');
  await client.query('GRANT ALL ON ALL TABLES IN SCHEMA auth TO service_role');
  await client.query('GRANT ALL ON ALL TABLES IN SCHEMA storage TO service_role');
  await client.query('GRANT SELECT ON ALL TABLES IN SCHEMA auth TO anon, authenticated');
  await client.query('GRANT SELECT ON ALL TABLES IN SCHEMA storage TO anon, authenticated');

  // Default privileges cover tables created after this shim runs (e.g. public.profile via dbInit).
  await client.query(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role',
  );
  await client.query(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, UPDATE ON TABLES TO authenticated',
  );
  await client.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon');
}
