/**
 * Applies the contract schema to a local Postgres origin via `prisma-next db init`.
 *
 * Reads LOCAL_DATABASE_URL from .dev.vars (if present), falls back to the
 * DATABASE_URL env var, then shells out to the CLI. Idempotent: safe to re-run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDevVars(): Record<string, string> {
  const path = resolve(process.cwd(), '.dev.vars');
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    out[key] = raw.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return out;
}

const devVars = loadDevVars();
const url =
  devVars['LOCAL_DATABASE_URL'] ?? process.env['LOCAL_DATABASE_URL'] ?? process.env['DATABASE_URL'];

if (!url) {
  console.error(
    'Set LOCAL_DATABASE_URL in .dev.vars (or DATABASE_URL in the environment) before running db:init.',
  );
  console.error('Hint: `pnpm db:dev` prints the TCP URL.');
  process.exit(1);
}

const result = spawnSync('pnpm', ['exec', 'prisma-next', 'db', 'init', '--db', url, '--yes'], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
