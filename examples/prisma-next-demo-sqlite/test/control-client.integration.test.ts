/**
 * Integration test demonstrating the programmatic control client.
 *
 * This test shows how to use createControlClient for database operations
 * instead of manual SQL and the stampMarker script.
 */

import { DatabaseSync } from 'node:sqlite';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../src/prisma/contract.d';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };
import { createPrismaNextControlClient, initTestDatabase } from './utils/control-client';
import { withTempSqliteDatabase } from './utils/with-temp-sqlite-db';

// Use the emitted JSON contract which has the real computed hashes
const contract = validateContract<Contract>(contractJson);

describe('control client integration', () => {
  it('initializes database schema from contract', async () => {
    await withTempSqliteDatabase(async ({ connectionString, filename }) => {
      // Use control client to initialize the database
      await initTestDatabase({ connection: connectionString, contractIR: contract });

      const db = new DatabaseSync(filename);
      try {
        const rows = db
          .prepare("select name from sqlite_master where type = 'table' order by name")
          .all() as Array<{ name: string }>;
        const names = rows.map((r) => r.name);
        expect(names).toContain('user');
        expect(names).toContain('post');
      } finally {
        db.close();
      }
    });
  });

  it('verifies database marker after sign', async () => {
    await withTempSqliteDatabase(async ({ connectionString }) => {
      // Initialize and sign database
      await initTestDatabase({ connection: connectionString, contractIR: contract });

      // Create a new client to verify
      const client = createPrismaNextControlClient({ connection: connectionString });
      try {
        const verifyResult = await client.verify({ contractIR: contract });

        expect(verifyResult).toMatchObject({
          ok: true,
          contract: { coreHash: expect.anything() },
        });
      } finally {
        await client.close();
      }
    });
  });

  it('schema verify passes after dbInit', async () => {
    await withTempSqliteDatabase(async ({ connectionString }) => {
      await initTestDatabase({ connection: connectionString, contractIR: contract });

      const client = createPrismaNextControlClient({ connection: connectionString });
      try {
        const schemaResult = await client.schemaVerify({ contractIR: contract });

        expect(schemaResult.ok).toBe(true);
      } finally {
        await client.close();
      }
    });
  });

  it('introspects database schema', async () => {
    await withTempSqliteDatabase(async ({ connectionString }) => {
      await initTestDatabase({ connection: connectionString, contractIR: contract });

      const client = createPrismaNextControlClient({ connection: connectionString });
      try {
        const schema = await client.introspect();

        // Schema should be an object with tables
        expect(schema).toBeDefined();
        expect(typeof schema).toBe('object');
      } finally {
        await client.close();
      }
    });
  });
});
