import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDevDatabase, type DevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { createServer, type ViteDevServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const exampleDir = dirname(dirname(fileURLToPath(import.meta.url)));
const schemaPath = join(exampleDir, 'prisma', 'schema.prisma');
const contractJsonPath = join(exampleDir, 'src', 'prisma', 'contract.json');

// Prisma Next's marker table plus our own model tables. Kept inline so the test
// reads top-to-bottom without chasing a fixture file.
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
        await waitForFileMtimeChange(contractJsonPath, preRevertMtime, 3_000);
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

      // Index-route convention: POST to ?index to disambiguate the index from its parent layout.
      const createResponse = await fetch(`${baseUrl}/?index`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: 'alice@example.com' }).toString(),
        redirect: 'follow',
      });
      expect(createResponse.ok).toBe(true);

      const listResponse = await fetch(`${baseUrl}/`);
      expect(listResponse.ok).toBe(true);
      const listBody = await listResponse.text();
      expect(listBody).toContain('alice@example.com');

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

      const followUpResponse = await fetch(`${baseUrl}/`);
      expect(followUpResponse.ok).toBe(true);
    },
    timeouts.spinUpPpgDev,
  );
});
