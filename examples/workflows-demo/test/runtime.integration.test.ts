import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { createPostgresDriver } from '@prisma-next/driver-postgres';
import { createRuntime } from '@prisma-next/runtime';
import { withClient, withDevDatabase } from '@prisma-next/runtime/test/utils';
import { schema } from '@prisma-next/sql/schema';
import { sql } from '@prisma-next/sql/sql';

import type { DataContract } from '@prisma-next/sql/types';

import { stampMarker } from '../src/prisma/scripts/stamp-marker';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractPath = join(__dirname, 'fixtures', 'basic-contract.json');
const contract: DataContract = JSON.parse(readFileSync(contractPath, 'utf8'));

describe('runtime execute integration', () => {
  it('streams rows and enforces marker verification', async () => {
    await withDevDatabase(async ({ connectionString }) => {
      const adapter = createPostgresAdapter();
      const driver = createPostgresDriver({ connectionString, cursor: { disabled: true } });
      const runtime = createRuntime({
        contract,
        adapter,
        driver,
        verify: { mode: 'always', requireMarker: true },
      });

      try {
        await stampMarker({
          connectionString,
          coreHash: contract.coreHash,
          profileHash: contract.profileHash ?? contract.coreHash,
        });

        await withClient(connectionString, async (client) => {
          await client.query(
            'create table if not exists "user" (id serial primary key, email text not null, "createdAt" timestamptz not null default now())',
          );
          await client.query('truncate table "user" restart identity');
          await client.query('insert into "user" (email, "createdAt") values ($1, now())', [
            'alice@example.com',
          ]);
        });

        const rowCount = await withClient(connectionString, async (client) => {
          const result = await client.query('select count(*)::int as count from "user"');
          return result.rows[0]?.count as number;
        });
        expect(rowCount).toBe(1);

        const tables = schema(contract).tables;
        const plan = sql({ contract, adapter })
          .from(tables.user)
          .select('id', 'email')
          .limit(10)
          .build();

        const rows: Array<{ id: number; email: string }> = [];
        for await (const row of runtime.execute(plan)) {
          rows.push(row as { id: number; email: string });
        }

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ email: 'alice@example.com' });

        const root = sql({ contract, adapter });
        const templatePlan = root.raw`
          select id, email from "user"
          where email = ${'alice@example.com'}
          limit ${1}
        `;

        const templateRows: Array<{ id: number; email: string }> = [];
        for await (const row of runtime.execute(templatePlan)) {
          templateRows.push(row as { id: number; email: string });
        }
        expect(templateRows).toHaveLength(1);

        const functionPlan = root.raw('select id from "user" where email = $1 limit $2', {
          params: ['alice@example.com', 1],
          refs: { tables: ['user'], columns: [{ table: 'user', column: 'email' }] },
          annotations: { intent: 'report' },
        });

        const functionRows: Array<{ id: number }> = [];
        for await (const row of runtime.execute(functionPlan)) {
          functionRows.push(row as { id: number });
        }
        expect(functionRows).toHaveLength(1);

        await stampMarker({
          connectionString,
          coreHash: 'sha256:mismatched-core',
          profileHash: contract.profileHash ?? contract.coreHash,
        });

        await expect(async () => {
          const iterator = runtime.execute(plan)[Symbol.asyncIterator]();
          await iterator.next();
        }).rejects.toMatchObject({ code: 'CONTRACT.MARKER_MISMATCH' });
      } finally {
        await runtime.close();
      }
    });
  });
});
