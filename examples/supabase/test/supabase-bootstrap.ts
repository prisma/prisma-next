/**
 * Minimal shared Supabase test fixture — first increment.
 *
 * Seeds a Postgres/PGlite database with the external Supabase schemas and
 * tables that the framework verifier expects when a composed contract declares
 * `auth.*` and `storage.*` tables as `external`. Without these tables present,
 * `db init`/`db update` will fail at the verify step because the framework
 * confirms declared `external` tables exist.
 *
 * **M1 scope (this file):** `CREATE SCHEMA auth, storage` + the four tables
 * (`auth.users`, `auth.identities`, `storage.buckets`, `storage.objects`) with
 * columns matching the Supabase extension contract's pinned model table.
 *
 * **Future increments:**
 * - `postgres-rls` constituent adds Postgres roles (`anon`, `authenticated`,
 *   `service_role`) and the `auth.uid()`, `auth.jwt()`, `auth.role()` functions.
 * - `cross-contract-refs` constituent seeds `auth.users` rows for FK tests.
 *
 * **Client interface:** accepts a `Client` from the `pg` package. The function
 * calls `client.query(sql)` directly — the same interface used by
 * `postgres-bootstrap.ts` and the `withClient` helper from
 * `@prisma-next/test-utils`.
 *
 * @example
 * ```ts
 * import { createDevDatabase, withClient } from '@prisma-next/test-utils';
 * import { bootstrapSupabaseShim } from './supabase-bootstrap';
 *
 * const db = await createDevDatabase();
 * await withClient(db.connectionString, async (client) => {
 *   await bootstrapSupabaseShim(client);
 * });
 * ```
 */
import type { Client } from 'pg';

/**
 * Seeds the database with the external Supabase schemas and tables.
 *
 * Creates two schemas (`auth`, `storage`) and four tables whose columns
 * exactly match the `@prisma-next/extension-supabase` contract:
 *
 * - `auth.users` — id uuid PK, email text, created_at timestamptz, updated_at timestamptz
 * - `auth.identities` — id uuid PK, user_id uuid, provider text, created_at timestamptz, updated_at timestamptz
 * - `storage.buckets` — id text PK, name text, created_at timestamptz, updated_at timestamptz
 * - `storage.objects` — id uuid PK, bucket_id text, name text, created_at timestamptz, updated_at timestamptz
 *
 * Does NOT create Postgres roles or `auth.*` functions — those are added by
 * the `postgres-rls` constituent.
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
}
