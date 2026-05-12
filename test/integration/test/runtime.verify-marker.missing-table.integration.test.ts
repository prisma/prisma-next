import pgvector from '@prisma-next/extension-pgvector/runtime';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import postgresServerless from '@prisma-next/postgres/serverless';
import { sql } from '@prisma-next/sql-builder/runtime';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contract } from './sql-builder/fixtures/contract';
import type { Contract } from './sql-builder/fixtures/generated/contract';

const sqlContract = validateContract<Contract>(contract, emptyCodecLookup);

describe(
  'runtime verify-marker: missing marker table',
  { timeout: timeouts.databaseOperation },
  () => {
    let connectionString: string;
    const closeFns: Array<() => Promise<void>> = [];

    beforeAll(async () => {
      const database = await createDevDatabase();
      connectionString = database.connectionString;
      closeFns.push(() => database.close());

      // Deliberately skip `prisma_contract.marker` — the scenario under test
      // is PN attaching to a database that has never had `db init` run.
      await withClient(connectionString, async (client) => {
        await client.query(`
          CREATE TABLE users (
            id int4 PRIMARY KEY,
            name text NOT NULL,
            email text NOT NULL,
            invited_by_id int4
          )
        `);
        await client.query(`
          INSERT INTO users (id, name, email, invited_by_id) VALUES
            (1, 'Alice', 'alice@example.com', NULL)
        `);
      });
    }, timeouts.spinUpPpgDev);

    afterAll(async () => {
      for (const fn of closeFns) {
        try {
          await fn();
        } catch {
          // ignore cleanup errors
        }
      }
    });

    it('postgresServerless with default verify (requireMarker: false) tolerates a missing marker table', async () => {
      const db = postgresServerless<Contract>({
        contract: sqlContract,
        extensions: [pgvector],
      });
      await using runtime = await db.connect({ url: connectionString });
      const builder = sql({ context: db.context });

      const rows = await runtime.execute(builder.users.select('id').build()).toArray();

      expect(rows.map((r) => r.id)).toEqual([1]);
    });

    it('postgresServerless with verify.mode: "always" + requireMarker: false tolerates a missing marker table on every call', async () => {
      const db = postgresServerless<Contract>({
        contract: sqlContract,
        extensions: [pgvector],
        verify: { mode: 'always', requireMarker: false },
      });
      await using runtime = await db.connect({ url: connectionString });
      const builder = sql({ context: db.context });

      const first = await runtime.execute(builder.users.select('id').build()).toArray();
      const second = await runtime.execute(builder.users.select('id').build()).toArray();

      expect(first.map((r) => r.id)).toEqual([1]);
      expect(second.map((r) => r.id)).toEqual([1]);
    });

    it('postgresServerless with requireMarker: true surfaces CONTRACT.MARKER_MISSING (not raw driver error) when the marker table is absent', async () => {
      const db = postgresServerless<Contract>({
        contract: sqlContract,
        extensions: [pgvector],
        verify: { mode: 'onFirstUse', requireMarker: true },
      });
      await using runtime = await db.connect({ url: connectionString });
      const builder = sql({ context: db.context });

      await expect(
        runtime.execute(builder.users.select('id').build()).toArray(),
      ).rejects.toMatchObject({
        code: 'CONTRACT.MARKER_MISSING',
      });
    });
  },
);
