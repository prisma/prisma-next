import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

import { upsertMarker } from '@prisma/marker';
import { createPostgresAdapter } from '@prisma/adapter-postgres/adapter';
import { createPostgresDriver } from '@prisma/driver-postgres';
import { schema } from '@prisma/sql/schema';
import { sql } from '@prisma/sql/sql';

import type { PostgresContract } from '@prisma/sql/types';

import { createRuntime } from '../src/index';

const connectionString = process.env.RUNTIME_TEST_DATABASE_URL;

if (!connectionString) {
  describe.skip('runtime execute integration', () => {
    it('requires RUNTIME_TEST_DATABASE_URL to be set', () => {
      // skipped
    });
  });
} else {
  const fixtureContract = loadContractFixture();
  const tables = schema(fixtureContract).tables;
  const adapter = createPostgresAdapter();
  const builder = sql({ contract: fixtureContract, adapter });
  const plan = builder.from(tables.user).select('id', 'email').limit(5).build();

  describe('runtime execute integration', () => {
    let client: Client;

    beforeAll(async () => {
      client = new Client({ connectionString });
      await client.connect();
      await client.query('create schema if not exists public');
      await client.query('drop table if exists "user"');
      await client.query('create table "user" (id serial primary key, email text not null)');
      await client.query('insert into "user" (email) values ($1), ($2), ($3)', [
        'ada@example.com',
        'tess@example.com',
        'mike@example.com',
      ]);

      await upsertMarker(client, {
        coreHash: fixtureContract.coreHash,
        profileHash: fixtureContract.profileHash ?? 'sha256:test-profile',
        contractJson: fixtureContract,
        canonicalVersion: 1,
      });
    });

    afterAll(async () => {
      await client.end();
    });

    let driverCleanup: (() => Promise<void>) | undefined;

    afterEach(async () => {
      if (driverCleanup) {
        await driverCleanup();
        driverCleanup = undefined;
      }
    });

    it('executes a plan after onFirstUse verification', async () => {
      const driver = createPostgresDriver({
        connectionString,
        cursor: { disabled: true },
      });
      driverCleanup = async () => {
        await driver.close();
      };
      await driver.connect();

      const runtime = createRuntime({
        contract: fixtureContract,
        adapter,
        driver,
        verify: { mode: 'onFirstUse', requireMarker: true },
      });

      const rows: Array<{ id: number; email: string }> = [];
      for await (const row of runtime.execute(plan)) {
        rows.push(row);
      }

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.map((r) => r.email)).toContain('ada@example.com');
      await runtime.close();
    });

    it('throws when marker hash mismatches contract', async () => {
      const driver = createPostgresDriver({
        connectionString,
        cursor: { disabled: true },
      });
      driverCleanup = async () => {
        await driver.close();
      };
      await driver.connect();

      const mismatchedContract: PostgresContract = {
        ...fixtureContract,
        coreHash: 'sha256:mismatch',
      };

      const runtime = createRuntime({
        contract: mismatchedContract,
        adapter,
        driver,
        verify: { mode: 'onFirstUse', requireMarker: true },
      });

      await expect(async () => {
        for await (const _ of runtime.execute(plan)) {
          // consume stream
        }
      }).rejects.toThrow(/MARKER_MISMATCH/);

      await runtime.close();
    });
  });
}

function loadContractFixture(): PostgresContract {
  const fixtureDir = dirname(fileURLToPath(import.meta.url));
  const contractPath = join(fixtureDir, '../../sql/test/fixtures/contract.json');
  const json = readFileSync(contractPath, 'utf8');
  return JSON.parse(json) as PostgresContract;
}
