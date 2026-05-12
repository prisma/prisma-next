/**
 * Vitest `globalSetup` for the cipherstash live-PG + EQL + ZeroKMS
 * e2e harness. Runs once at the start of the entire e2e run.
 *
 * Responsibilities:
 *
 *   1. Load the example app's `.env` into `process.env` so test
 *      workers inherit `CS_*` credentials and (after we override it
 *      below) `DATABASE_URL`.
 *   2. Verify the harness's Postgres container is reachable (the
 *      developer is responsible for `docker compose up -d`; the
 *      harness reports a clear actionable error when it's not up
 *      rather than orchestrating Docker itself).
 *   3. Apply the example app's migrations against the harness DB —
 *      the cipherstash baseline (EQL bundle install + per-column
 *      search configs) plus the application `users` table. The
 *      apply is idempotent at the marker level so a re-run on a
 *      warm container is a no-op.
 *   4. Truncate the `users` table for a clean slate per harness
 *      boot. Each test file owns its own seed data with file-scoped
 *      ID prefixes; the truncate guards against state bleeding
 *      between full-run iterations of the suite.
 *
 * No teardown — the container lifecycle is owned by the developer
 * (`docker compose down` from `examples/cipherstash-integration`
 * tears it down explicitly).
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const HARNESS_DATABASE_URL = 'postgres://cipherstash:cipherstash@localhost:54329/cipherstash_e2e';
const POSTGRES_CONTAINER = 'cipherstash-e2e-postgres';

export default async function setup(): Promise<() => Promise<void>> {
  const exampleDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

  loadDotenv({ path: resolve(exampleDir, '.env') });

  if (!process.env['CS_WORKSPACE_CRN']) {
    throw new Error(
      'cipherstash e2e harness: `CS_WORKSPACE_CRN` is not set. Populate `.env` ' +
        '(see `.env.example`) with a ZeroKMS workspace and the three companion ' +
        'credentials before running `pnpm test:e2e`.',
    );
  }

  const pgIsReady = spawnSync(
    'docker',
    ['exec', POSTGRES_CONTAINER, 'pg_isready', '-U', 'cipherstash', '-d', 'cipherstash_e2e'],
    { stdio: 'pipe' },
  );
  if (pgIsReady.status !== 0) {
    throw new Error(
      `cipherstash e2e harness: container \`${POSTGRES_CONTAINER}\` is not running ` +
        'or not accepting connections. Bring it up with:\n' +
        '  docker compose -f test/e2e/docker-compose.yml up -d\n' +
        '(from `examples/cipherstash-integration`).',
    );
  }

  // Override DATABASE_URL so the CLI and the test workers both point
  // at the harness container, not the developer's `.env` value (which
  // is for the `pnpm start` demo loop).
  process.env['DATABASE_URL'] = HARNESS_DATABASE_URL;

  const cliBin = resolve(exampleDir, 'node_modules', '.bin', 'prisma-next');
  const apply = spawnSync(cliBin, ['migration', 'apply'], {
    cwd: exampleDir,
    stdio: 'pipe',
    env: process.env,
  });
  if (apply.status !== 0) {
    throw new Error(
      `cipherstash e2e harness: \`prisma-next migration apply\` failed (exit ${apply.status}):\n` +
        `--- stderr ---\n${apply.stderr?.toString() ?? ''}\n` +
        `--- stdout ---\n${apply.stdout?.toString() ?? ''}`,
    );
  }

  // Clean slate for the suite. The `users` table is the only data-bearing
  // application table; the EQL bundle tables (`eql_v2_configuration` etc.)
  // are state we want to keep.
  const truncate = spawnSync(
    'docker',
    [
      'exec',
      POSTGRES_CONTAINER,
      'psql',
      '-U',
      'cipherstash',
      '-d',
      'cipherstash_e2e',
      '-c',
      'TRUNCATE TABLE users',
    ],
    { stdio: 'pipe' },
  );
  if (truncate.status !== 0) {
    throw new Error(
      `cipherstash e2e harness: TRUNCATE failed (exit ${truncate.status}):\n` +
        `${truncate.stderr?.toString() ?? ''}\n${truncate.stdout?.toString() ?? ''}`,
    );
  }

  return async () => {};
}
