/**
 * Shared Supabase test fixture — seeds the external schemas, tables, roles, and grants.
 *
 * Seeds a Postgres/PGlite database with the external Supabase schemas and
 * tables that the framework verifier expects when a composed contract declares
 * `auth.*` and `storage.*` tables as `external`. Without these tables present,
 * `db init`/`db update` will fail at the verify step because the framework
 * confirms declared `external` tables exist.
 *
 * Also creates the three Postgres roles (`anon`, `authenticated`, `service_role`)
 * with grants that mirror a real Supabase database. `ALTER DEFAULT PRIVILEGES`
 * ensures tables created after the shim runs (e.g. `public.profile` via `dbInit`)
 * are automatically accessible to the roles.
 *
 * The caller owns the client lifecycle — pass any already-connected `pg.Client`
 * (e.g. one the test is sharing across setup steps, or one bound to a
 * transaction for isolation). Convenience wrapper for tests that don't already
 * have one:
 *
 * @example
 * ```ts
 * import { withClient } from '@prisma-next/test-utils';
 * import { bootstrapSupabaseShim } from '@prisma-next/extension-supabase/test/utils';
 *
 * await withClient(connectionString, async (client) => {
 *   await bootstrapSupabaseShim(client);
 * });
 * ```
 */
import type { Client } from 'pg';

/**
 * Seeds the database with the external Supabase schemas, tables, roles, and grants.
 * The caller passes an already-connected `pg.Client` — this function does not
 * open or close connections.
 *
 * Creates two schemas (`auth`, `storage`) and four tables whose columns
 * exactly match the `@prisma-next/extension-supabase` contract:
 *
 * - `auth.users` — id uuid PK, email text, created_at timestamptz, updated_at timestamptz
 * - `auth.identities` — id uuid PK, user_id uuid, provider text, created_at timestamptz, updated_at timestamptz
 * - `storage.buckets` — id text PK, name text, created_at timestamptz, updated_at timestamptz
 * - `storage.objects` — id uuid PK, bucket_id text, name text, created_at timestamptz, updated_at timestamptz
 *
 * Creates the three Postgres roles and grants that mirror a real Supabase database.
 * `ALTER DEFAULT PRIVILEGES` covers tables created after the shim runs (e.g. via `dbInit`).
 * WAL grants are guarded by a schema-existence check — a PGlite single-connection
 * accommodation so role-bound sessions can interleave with the WAL drain query.
 */
export async function bootstrapSupabaseShim(client: Client): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS auth');
  await client.query('CREATE SCHEMA IF NOT EXISTS storage');

  await client.query(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id          uuid        NOT NULL,
      email       text        NOT NULL,
      created_at  timestamptz NOT NULL,
      updated_at  timestamptz NOT NULL,
      PRIMARY KEY (id)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS auth.identities (
      id          uuid        NOT NULL,
      user_id     uuid        NOT NULL,
      provider    text        NOT NULL,
      created_at  timestamptz NOT NULL,
      updated_at  timestamptz NOT NULL,
      PRIMARY KEY (id)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS storage.buckets (
      id          text        NOT NULL,
      name        text        NOT NULL,
      created_at  timestamptz NOT NULL,
      updated_at  timestamptz NOT NULL,
      PRIMARY KEY (id)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS storage.objects (
      id          uuid        NOT NULL,
      bucket_id   text        NOT NULL,
      name        text        NOT NULL,
      created_at  timestamptz NOT NULL,
      updated_at  timestamptz NOT NULL,
      PRIMARY KEY (id)
    )
  `);

  // Roles + grants mirror a real Supabase database; WAL grants are a
  // PGlite-single-connection test accommodation.
  await client.query('CREATE ROLE anon NOLOGIN');
  await client.query('CREATE ROLE authenticated NOLOGIN');
  await client.query('CREATE ROLE service_role NOLOGIN BYPASSRLS');
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
