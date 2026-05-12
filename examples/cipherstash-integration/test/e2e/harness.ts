/**
 * Shared harness module for the cipherstash live PG + EQL + ZeroKMS
 * e2e suite. Owns the singleton runtime connection and provides
 * tiny conveniences each test file calls in `beforeAll`.
 *
 * Lifecycle:
 *   - `globalSetup` (separate process) verifies Docker + applies
 *     migrations + truncates `users`.
 *   - Each test file (worker process, shared because `isolate: false`
 *     + `maxWorkers: 1`) calls `ensureConnected()` in `beforeAll`.
 *     The first caller awaits `db.connect(...)`; subsequent callers
 *     await the cached promise.
 *
 * No `afterAll` cleanup of rows is required: tests use file-scoped
 * ID prefixes (`e2e-num-`, `e2e-bool-`, ...) so cross-file
 * collisions are impossible. `globalSetup` truncates the table once
 * per suite boot, so re-runs start clean.
 *
 * The harness intentionally does *not* close the runtime in any
 * teardown hook. Vitest's `globalSetup` teardown runs in a different
 * process, and adding an in-process teardown coordinator
 * (`globalThis`-shared latch, last-file detection, ...) is
 * disproportionate for a development suite. The pg pool's idle
 * timeout retires its connections; the Node process exits when
 * vitest is done.
 */

import { spawnSync } from 'node:child_process';
import { db } from '../../src/db';

let connection: Promise<unknown> | undefined;

export function ensureConnected(): Promise<unknown> {
  if (!connection) {
    const url = process.env['DATABASE_URL'];
    if (!url) {
      throw new Error(
        'cipherstash e2e harness: `DATABASE_URL` is not set; ' +
          'global-setup.ts should have populated it from the harness Postgres URL.',
      );
    }
    connection = db.connect({ url });
  }
  return connection;
}

/**
 * Truncate the `users` table to give a single test file a clean
 * slate. Called from `beforeAll` so per-file assertions ("expect
 * exactly N rows matching X") don't bleed across files.
 *
 * Shells out to `docker exec ... psql -c TRUNCATE` rather than going
 * through a separate `pg.Pool` to avoid pulling a second postgres
 * driver into the example's deps. The container is guaranteed to be
 * up — `globalSetup` would have failed the run otherwise.
 */
export function truncateUsers(): void {
  const result = spawnSync(
    'docker',
    [
      'exec',
      'cipherstash-e2e-postgres',
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
  if (result.status !== 0) {
    throw new Error(
      `cipherstash e2e harness: TRUNCATE failed (exit ${result.status}):\n` +
        `${result.stderr?.toString() ?? ''}\n${result.stdout?.toString() ?? ''}`,
    );
  }
}

export { db };
