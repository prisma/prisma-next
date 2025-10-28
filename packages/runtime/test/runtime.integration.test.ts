import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

import { unstable_startServer } from '@prisma/dev';
import { createPostgresAdapter } from '../../adapter-postgres/src/adapter';
import { schema } from '@prisma/sql/schema';
import { sql } from '@prisma/sql/sql';

import type { PostgresContract } from '@prisma/sql/types';

import { createRuntime } from '../src/index';
import { ensureSchemaStatement, ensureTableStatement, writeContractMarker } from '../src/marker';
import { createPostgresDriver } from '../../driver-postgres/src/index';

const fixtureContract = loadContractFixture();
const tables = schema(fixtureContract).tables;
const adapter = createPostgresAdapter();
const builder = sql({ contract: fixtureContract, adapter });
const plan = builder.from(tables.user).select('id', 'email').limit(5).build();

describe('runtime execute integration', () => {
  const serverPromise = unstable_startServer();
  let connectionString: string;

  beforeAll(async () => {
    const server = await serverPromise;
    connectionString = server.database.connectionString;
  });

  afterAll(async () => {
    const server = await serverPromise;
    await server.close();
  });

  beforeEach(async () => {
    const seedClient = new Client({ connectionString });
    await seedClient.connect();

    try {
      await seedClient.query('drop schema if exists prisma_contract cascade');
      await seedClient.query('create schema if not exists public');
      await seedClient.query('drop table if exists "user"');
      await seedClient.query('create table "user" (id serial primary key, email text not null)');
      await seedClient.query('insert into "user" (email) values ($1), ($2), ($3)', [
        'ada@example.com',
        'tess@example.com',
        'mike@example.com',
      ]);

      await seedClient.query(ensureSchemaStatement.sql);
      await seedClient.query(ensureTableStatement.sql);

      const write = writeContractMarker({
        coreHash: fixtureContract.coreHash,
        profileHash: fixtureContract.profileHash ?? 'sha256:test-profile',
        contractJson: fixtureContract,
        canonicalVersion: 1,
      });
      await seedClient.query(write.insert.sql, [...write.insert.params]);
    } finally {
      await seedClient.end();
    }
  });

  afterEach(async () => {
    const cleanupClient = new Client({ connectionString });
    await cleanupClient.connect();
    try {
      await cleanupClient.query('drop schema if exists prisma_contract cascade');
      await cleanupClient.query('drop table if exists "user"');
    } finally {
      await cleanupClient.end();
    }
  });

  it('executes a plan after onFirstUse verification', async () => {
    const driver = createPostgresDriver({
      connectionString,
      cursor: { disabled: true },
    });
    await driver.connect();

    const runtime = createRuntime({
      contract: fixtureContract,
      adapter,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: true },
    });

    try {
      const rows: Array<{ id: number; email: string }> = [];
      for await (const row of runtime.execute(plan)) {
        const typed = row as { id: number; email: string };
        rows.push(typed);
      }

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.map((r) => r.email)).toContain('ada@example.com');
    } finally {
      await runtime.close();
    }
  }, 15000);

  it('throws when marker hash mismatches contract', async () => {
    const driver = createPostgresDriver({
      connectionString,
      cursor: { disabled: true },
    });
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

    try {
      await expect(async () => {
        for await (const _ of runtime.execute(plan)) {
          // consume stream
        }
      }).rejects.toMatchObject({ code: 'PLAN.HASH_MISMATCH' });
    } finally {
      await runtime.close();
    }
  }, 15000);
});

function loadContractFixture(): PostgresContract {
  const fixtureDir = dirname(fileURLToPath(import.meta.url));
  const contractPath = join(fixtureDir, '../../sql/test/fixtures/contract.json');
  const json = readFileSync(contractPath, 'utf8');
  return JSON.parse(json) as PostgresContract;
}
