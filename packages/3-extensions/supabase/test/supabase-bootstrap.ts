/**
 * Shared Supabase test fixture — seeds the external schemas, tables, roles, and functions.
 *
 * Seeds a Postgres/PGlite database with the external Supabase schemas and
 * tables that the framework verifier expects when a composed contract declares
 * `auth.*` and `storage.*` tables as `external`. Without these tables present,
 * `db init`/`db update` will fail at the verify step because the framework
 * confirms declared `external` tables exist.
 *
 * **M1 scope:** `CREATE SCHEMA auth, storage` + the four tables
 * (`auth.users`, `auth.identities`, `storage.buckets`, `storage.objects`) with
 * columns matching the Supabase extension contract's pinned model table.
 *
 * **postgres-rls constituent (M2):** adds the three Supabase platform roles
 * (`anon`, `authenticated`, `service_role`) and the `auth.uid()` function that
 * RLS policies reference. In real Supabase these are platform-provided; the
 * shim emulates them for local test databases.
 *
 * **Future increments:**
 * - `cross-contract-refs` constituent seeds `auth.users` rows for FK tests.
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
 * Creates two schemas (`auth`, `storage`) and four tables whose columns
 * exactly match the `@prisma-next/extension-supabase` contract:
 *
 * - `auth.users` — id uuid PK, email text, created_at timestamptz, updated_at timestamptz
 * - `auth.identities` — id uuid PK, user_id uuid, provider text, created_at timestamptz, updated_at timestamptz
 * - `storage.buckets` — id text PK, name text, created_at timestamptz, updated_at timestamptz
 * - `storage.objects` — id uuid PK, bucket_id text, name text, created_at timestamptz, updated_at timestamptz
 *
 * Also creates the three Supabase platform roles (`anon`, `authenticated`,
 * `service_role`) and the `auth.uid()` function that reads the current user's
 * id from the `request.jwt.claims` GUC, matching Supabase's implementation.
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
        CREATE ROLE service_role NOLOGIN;
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
}
