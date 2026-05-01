/**
 * Applies the contract schema to a local Postgres origin via `prisma-next db init`.
 *
 * Reads WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE from `.env`
 * (the same env var Wrangler uses for the Hyperdrive binding's local
 * connection string), falls back to the same name in the process env, then
 * to `DATABASE_URL`. Idempotent: safe to re-run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnv(filename: string): Record<string, string> {
  const path = resolve(process.cwd(), filename);
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

const HYPERDRIVE_VAR = 'WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE';
const fileVars = loadDotEnv('.env');
const url = fileVars[HYPERDRIVE_VAR] ?? process.env[HYPERDRIVE_VAR] ?? process.env['DATABASE_URL'];

if (!url) {
  console.error(
    `Set ${HYPERDRIVE_VAR} in .env (or DATABASE_URL in the environment) before running db:init.`,
  );
  console.error('Hint: `pnpm db:dev` prints the TCP URL.');
  process.exit(1);
}

const result = spawnSync('pnpm', ['exec', 'prisma-next', 'db', 'init', '--db', url, '--yes'], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
