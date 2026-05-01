import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

interface GlobalSetupContext {
  provide<K extends keyof import('vitest').ProvidedContext & string>(
    key: K,
    value: import('vitest').ProvidedContext[K],
  ): void;
}

declare module 'vitest' {
  export interface ProvidedContext {
    'database-url': string;
    'alice-id': string;
    'bob-id': string;
  }
}

const HYPERDRIVE_VAR = 'WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE';
const exampleRoot = fileURLToPath(new URL('..', import.meta.url));

function normalize(connectionString: string): string {
  const url = new URL(connectionString);
  if (url.hostname === 'localhost' || url.hostname === '::1') {
    url.hostname = '127.0.0.1';
  }
  return url.toString();
}

function loadDotEnv(filename: string): Record<string, string> {
  const path = `${exampleRoot}/${filename}`;
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

function resolveDatabaseUrl(): string {
  const fileVars = loadDotEnv('.env');
  const url = fileVars[HYPERDRIVE_VAR] ?? process.env[HYPERDRIVE_VAR];
  if (!url) {
    throw new Error(
      `[global-setup] ${HYPERDRIVE_VAR} not set. Run \`pnpm db:up\` and copy \`.env.example\` to \`.env\`.`,
    );
  }
  return normalize(url);
}

async function ensureContainerReady(databaseUrl: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      await client.query('select 1');
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      try {
        await client.end();
      } catch {
        // ignore
      }
    }
  }
  throw new Error(
    `[global-setup] Postgres at ${databaseUrl} unreachable after 15s. Did you run \`pnpm db:up\`? Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

async function applySchema(databaseUrl: string): Promise<void> {
  const result = spawnSync(
    'pnpm',
    ['exec', 'prisma-next', 'db', 'init', '--db', databaseUrl, '--yes', '--no-color'],
    { cwd: exampleRoot, stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(`prisma-next db init failed with status ${result.status ?? 'unknown'}`);
  }
}

const ALICE_ID = '00000000-0000-4000-8000-000000000001';
const BOB_ID = '00000000-0000-4000-8000-000000000002';

async function resetAndSeed(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // Wipe in dependency order so re-runs against a long-lived container start clean.
    await client.query('TRUNCATE "post", "task", "user" RESTART IDENTITY CASCADE');

    await client.query(
      `INSERT INTO "user" (id, email, "displayName", "createdAt", kind, address) VALUES
        ($1, 'alice@example.com', 'Alice', '2026-04-01T00:00:00Z', 'admin',
         '{"street":"123 Main St","city":"San Francisco","zip":"94102","country":"US"}'::jsonb),
        ($2, 'bob@example.com',   'Bob',   '2026-04-02T00:00:00Z', 'user',
         '{"street":"456 Oak Ave","city":"Portland","zip":null,"country":"US"}'::jsonb)`,
      [ALICE_ID, BOB_ID],
    );

    const postRows: string[] = [];
    for (let i = 0; i < 50; i++) {
      const id = `10000000-0000-4000-8000-${(i + 1).toString().padStart(12, '0')}`;
      const userId = i % 2 === 0 ? ALICE_ID : BOB_ID;
      postRows.push(
        `('${id}', 'Post ${i + 1}', '${userId}', '2026-04-${(10 + (i % 20)).toString().padStart(2, '0')}T10:00:00Z')`,
      );
    }
    await client.query(
      `INSERT INTO "post" (id, title, "userId", "createdAt") VALUES ${postRows.join(', ')}`,
    );
  } finally {
    await client.end();
  }
}

export default async function setup({ provide }: GlobalSetupContext) {
  const databaseUrl = resolveDatabaseUrl();
  console.log(`[global-setup] connecting to Postgres at ${databaseUrl}`);

  await ensureContainerReady(databaseUrl);
  await applySchema(databaseUrl);
  await resetAndSeed(databaseUrl);

  provide('database-url', databaseUrl);
  provide('alice-id', ALICE_ID);
  provide('bob-id', BOB_ID);

  // No teardown: the container is owned by the maker (`pnpm db:up`/`pnpm db:down`).
  return async () => {};
}
