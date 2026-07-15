/**
 * Restores the checked-in Supabase reference fixture (`roles.sql` +
 * `schema.sql` in this directory) into a database. Roles are restored first
 * — the schema's policies and grants reference `anon`/`authenticated`/
 * `service_role`/etc.
 *
 * Used by the pack's `contract:generate` script (introspection source) and
 * by the round-trip verify integration test.
 *
 * Each file is sent as one multi-statement query (`pg`'s simple query
 * protocol runs semicolon-separated statements in order) rather than one
 * round trip per statement — ~75x faster in practice (single-statement
 * round trips to even a local PGlite server dominate the restore's cost far
 * more than PGlite's own execution time; roughly 9s vs ~120ms for these two
 * files). Splitting into individual statements is a debugging aid for
 * trimming a *new* fixture capture (see the header comments in `schema.sql`
 * / `roles.sql`), not something the restored-clean, checked-in fixture needs
 * at every test run.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from 'pg';

/**
 * Resolves this directory by the package's own `package.json` rather than
 * `import.meta.url` — this module is also bundled into `dist/test/utils.mjs`
 * (the package's `./test/utils` export, tsdown entry `test/supabase-bootstrap.ts`),
 * so `import.meta.url`-relative resolution would point at `dist/test/`, where
 * `roles.sql`/`schema.sql` don't exist (tsdown bundles code, not the fixture's
 * data files). Resolving via the package name instead survives bundling: the
 * `package.json` self-reference always resolves to the real package root,
 * and the fixture's `.sql` files never move from their source location.
 */
function resolveFixtureDir(): string {
  const packageJsonUrl = import.meta.resolve('@prisma-next/extension-supabase/package.json');
  return join(dirname(fileURLToPath(packageJsonUrl)), 'test', 'fixtures', 'supabase-reference');
}

export async function restoreSupabaseReference(client: Client): Promise<void> {
  const fixtureDir = resolveFixtureDir();
  const rolesSql = readFileSync(join(fixtureDir, 'roles.sql'), 'utf8');
  const schemaSql = readFileSync(join(fixtureDir, 'schema.sql'), 'utf8');

  await client.query(rolesSql);
  await client.query(schemaSql);

  // pg_dump's preamble includes session-local `SET`s (e.g. `SET row_security
  // = off;`, `SELECT pg_catalog.set_config('search_path', '', false);`) that
  // are meant to make the dump itself replay deterministically — not to
  // persist afterward. `client.query` runs each file on the caller's own
  // session, so without a reset those settings leak into whatever the caller
  // does next on this client: `row_security = off` in particular lets a
  // non-owner bypass RLS entirely, silently invalidating any RLS test that
  // reuses this client. Resetting every session-local setting back to its
  // startup default after the restore keeps the fixture's replay-only
  // settings from escaping into the caller's session.
  await client.query('RESET ALL');
}
