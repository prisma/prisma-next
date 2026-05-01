import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDevDatabase, type DevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { createServer, type ViteDevServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const exampleDir = dirname(dirname(fileURLToPath(import.meta.url)));
const schemaPath = join(exampleDir, 'prisma', 'contract.prisma');
const contractJsonPath = join(exampleDir, 'src', 'prisma', 'contract.json');

// Bootstraps Prisma Next's marker table plus our own model tables via raw DDL
// rather than going through the control client's `dbInit`. This smoke test's job
// is to validate auto-emit and serving through the framework runtime, not to
// exercise the migration system — that is covered by the `db init` integration
// tests in `test/integration/test/cli.db-init.e2e.test.ts`. Inlining the DDL keeps
// this test readable top-to-bottom without a fixture file or a control-client
// setup that would expand the scope and the flake surface.
const TEST_SCHEMA_SQL = `
create schema if not exists prisma_contract;
create table if not exists prisma_contract.marker (
  id smallint primary key default 1,
  core_hash text not null default '',
  profile_hash text not null default '',
  contract_json jsonb,
  canonical_version int,
  updated_at timestamptz not null default now(),
  app_tag text,
  meta jsonb not null default '{}'
);
create table if not exists "user" (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  "createdAt" timestamptz not null default now()
);
create table if not exists "post" (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  "userId" uuid not null references "user"(id),
  "createdAt" timestamptz not null default now()
);
`;

async function waitForFileMtimeChange(
  filePath: string,
  originalMtime: number | null,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(filePath)) {
      const { mtimeMs } = await stat(filePath);
      if (originalMtime === null || mtimeMs > originalMtime) {
        return true;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function createUser(baseUrl: string, email: string): Promise<void> {
  const response = await fetch(`${baseUrl}/?index`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email }).toString(),
    redirect: 'follow',
  });
  expect(response.ok).toBe(true);
}

describe('react-router-demo smoke (e2e)', () => {
  let dev: DevDatabase | null = null;
  let server: ViteDevServer | null = null;
  let originalSchema: string | null = null;

  beforeEach(async () => {
    originalSchema = readFileSync(schemaPath, 'utf-8');
    dev = await createDevDatabase();
    await withClient(dev.connectionString, async (client) => {
      await client.query(TEST_SCHEMA_SQL);
    });
    vi.stubEnv('DATABASE_URL', dev.connectionString);
    // @prisma/dev (PGlite) rejects concurrent connections; cap the example's
    // pg pool at 1 only here so the production code path stays unconstrained.
    vi.stubEnv('PRISMA_NEXT_DEMO_PG_POOL_MAX', '1');
  });

  afterEach(async () => {
    // Revert the schema first so the still-running plugin re-emits clean
    // artifacts, then close the server so nothing is left mid-flight, then tear
    // down the dev database and unstub the env.
    if (originalSchema !== null) {
      const preRevertMtime = existsSync(contractJsonPath)
        ? (await stat(contractJsonPath)).mtimeMs
        : null;
      writeFileSync(schemaPath, originalSchema);
      originalSchema = null;
      if (server) {
        await waitForFileMtimeChange(
          contractJsonPath,
          preRevertMtime,
          timeouts.typeScriptCompilation,
        );
      }
    }
    if (server) {
      await server.close();
      server = null;
    }
    if (dev) {
      await dev.close();
      dev = null;
    }
    vi.unstubAllEnvs();
  });

  it(
    're-emits contract on PSL edit and serves requests through the framework runtime',
    async () => {
      server = await createServer({
        root: exampleDir,
        mode: 'development',
        logLevel: 'silent',
        server: { host: '127.0.0.1', port: 0, strictPort: false },
      });
      await server.listen();

      const address = server.httpServer?.address();
      if (!address || typeof address === 'string') {
        throw new Error('expected HTTP server to bind to a TCP address');
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const initialEmit = await waitForFileMtimeChange(
        contractJsonPath,
        null,
        timeouts.typeScriptCompilation,
      );
      expect(initialEmit).toBe(true);

      const initialMtime = (await stat(contractJsonPath)).mtimeMs;

      if (dev === null) {
        throw new Error('beforeEach must have created a dev database before the test body runs');
      }
      await withClient(dev.connectionString, async (client) => {
        await client.query(
          'insert into "user" (email, "createdAt") values ($1, now() - interval \'1 hour\')',
          ['alice@example.com'],
        );
      });
      await createUser(baseUrl, 'bob@example.com');

      const listResponse = await fetch(`${baseUrl}/`);
      expect(listResponse.ok).toBe(true);
      const listBody = await listResponse.text();
      expect(listBody).toContain('alice@example.com');
      expect(listBody.indexOf('bob@example.com')).toBeLessThan(
        listBody.indexOf('alice@example.com'),
      );

      if (originalSchema === null) {
        throw new Error('beforeEach must have captured originalSchema before the test body runs');
      }
      const editedSchema = originalSchema.replace(
        '  email     String\n',
        '  email     String\n  nickname  String?\n',
      );
      // Guard against schema reformats silently breaking the test.
      expect(editedSchema).not.toBe(originalSchema);
      writeFileSync(schemaPath, editedSchema);

      const reEmit = await waitForFileMtimeChange(
        contractJsonPath,
        initialMtime,
        timeouts.typeScriptCompilation,
      );
      expect(reEmit).toBe(true);

      const updatedContract: unknown = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
      expect(updatedContract).toMatchObject({
        storage: {
          tables: {
            user: {
              columns: { nickname: expect.anything() },
            },
          },
        },
      });

      // Pull a fresh `db.server` module via Vite's SSR module loader to prove
      // that the framework runtime — not just the on-disk artifact — sees the
      // newly emitted column. If the HMR dispose handler stopped invalidating
      // the cached runtime (or the plugin failed to invalidate `db.server.ts`
      // when `contract.json` changed), the module would still hold a reference
      // to a stale `contract.json` and `select('nickname')` would synchronously
      // throw `Column "nickname" not found in scope` from the SQL builder.
      // ssrLoadModule's typed return is `Record<string, any>`; cast once to
      // the narrow shape we exercise here so the rest of the test stays typed.
      const freshModule = (await server.ssrLoadModule('/app/lib/db.server.ts')) as unknown as {
        getDb: () => {
          sql: {
            user: {
              select(...columns: readonly string[]): { build(): unknown };
            };
          };
        };
      };
      const freshDb = freshModule.getDb();
      expect(() => freshDb.sql.user.select('id', 'email', 'nickname').build()).not.toThrow();

      const followUpResponse = await fetch(`${baseUrl}/`);
      expect(followUpResponse.ok).toBe(true);
    },
    timeouts.spinUpPpgDev,
  );
});
