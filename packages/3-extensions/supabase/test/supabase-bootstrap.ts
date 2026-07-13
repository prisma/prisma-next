/**
 * Shared Supabase test fixture — seeds the external schemas, tables, roles, and functions.
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
 * Seeds the database with the external Supabase schemas, tables, roles, and
 * functions. The caller passes an already-connected `pg.Client` — this
 * function does not open or close connections.
 *
 * Creates two schemas (`auth`, `storage`), the `auth.aal_level` native enum
 * type, and five tables whose columns exactly match the
 * `@prisma-next/extension-supabase` contract:
 *
 * - `auth.users` — id uuid PK, email text, created_at timestamptz, updated_at timestamptz
 * - `auth.identities` — id uuid PK, user_id uuid, provider text, created_at timestamptz, updated_at timestamptz
 * - `auth.sessions` — id uuid PK, user_id uuid, aal auth.aal_level, created_at timestamptz
 * - `storage.buckets` — id text PK, name text, created_at timestamptz, updated_at timestamptz
 * - `storage.objects` — id uuid PK, bucket_id text, name text, created_at timestamptz, updated_at timestamptz
 *
 * Also creates the three Supabase platform roles (`anon`, `authenticated`,
 * `service_role`) and the `auth.uid()` function that reads the current user's
 * id from the `request.jwt.claims` GUC, matching Supabase's implementation.
 * `ALTER DEFAULT PRIVILEGES` covers tables created after the shim runs (e.g. via `dbInit`).
 */
export async function bootstrapSupabaseShim(client: Client): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS auth');
  await client.query('CREATE SCHEMA IF NOT EXISTS storage');

  // Supabase platform roles — created idempotently; real Supabase provides
  // these as platform infrastructure; the shim emulates them for test DBs.
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      END IF;
    END
    $$
  `);

  // auth.uid() — returns the current request's user id from the settable GUC
  // request.jwt.claims, matching Supabase's implementation. Returns NULL when
  // the GUC is unset (missing_ok = true).
  await client.query(`
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
      SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid
    $$
  `);

  // auth.aal_level — a native Postgres enum type; Postgres has no `CREATE
  // TYPE IF NOT EXISTS`, so existence is checked via pg_type first, matching
  // the idempotency style used above for roles. Real Supabase ships this
  // type as platform infrastructure; the shim creates it for test DBs so the
  // externally-managed `native_enum` in the extension's contract has a type
  // to bind against (Prisma Next emits no DDL for it).
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'aal_level' AND n.nspname = 'auth'
      ) THEN
        CREATE TYPE auth.aal_level AS ENUM ('aal1', 'aal2', 'aal3');
      END IF;
    END
    $$
  `);

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
    CREATE TABLE IF NOT EXISTS auth.sessions (
      id          uuid        NOT NULL,
      user_id     uuid        NOT NULL,
      aal         auth.aal_level,
      created_at  timestamptz NOT NULL DEFAULT now(),
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

  // Grants mirror a real Supabase database.
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
