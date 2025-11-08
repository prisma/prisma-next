import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { createRuntimeContext } from '@prisma-next/runtime';
import {
  createTestRuntimeFromClient,
  executePlanAndCollect,
  setupE2EDatabase,
} from '@prisma-next/runtime/test/utils';
import { schema } from '@prisma-next/sql-query/schema';
import { sql } from '@prisma-next/sql-query/sql';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { emitAndVerifyContract, loadContractFromDisk } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../../..');

describe('end-to-end basic queries', () => {
  const adapterPath = resolve(repoRoot, 'packages/adapter-postgres');
  const cliPath = resolve(repoRoot, 'packages/cli/dist/cli.js');
  const contractTsPath = resolve(__dirname, 'fixtures/contract.ts');
  const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

  it('emits contract and verifies it matches on-disk artifacts', async () => {
    const outputDir = resolve(__dirname, '../.tmp-output');
    await emitAndVerifyContract(cliPath, contractTsPath, adapterPath, outputDir, contractJsonPath);
  });

  it(
    'returns multiple rows with correct types',
    async () => {
      const contract = await loadContractFromDisk<Contract>(contractJsonPath);

      await withDevDatabase(
        async ({ connectionString }: { connectionString: string }) => {
          await withClient(connectionString, async (client: import('pg').Client) => {
            await setupE2EDatabase(client, contract, async (c: typeof client) => {
              await c.query('drop table if exists "user"');
              await c.query('create table "user" (id serial primary key, email text not null)');
              await c.query('insert into "user" (email) values ($1), ($2), ($3)', [
                'ada@example.com',
                'tess@example.com',
                'mike@example.com',
              ]);
            });

            const adapter = createPostgresAdapter();
            const context = createRuntimeContext({ contract, adapter, extensions: [] });
            const runtime = createTestRuntimeFromClient(contract, client, adapter);
            try {
              const tables = schema<Contract>(context).tables;
              const user = tables.user!;
              const plan = sql({ context })
                .from(user)
                .select({ id: user.columns.id!, email: user.columns.email! })
                .build();

              const rows = await executePlanAndCollect(runtime, plan);

              expect(rows.length).toBeGreaterThan(1);
              expect(rows[0]).toMatchObject({
                id: expect.any(Number),
                email: expect.any(String),
              });
            } finally {
              await runtime.close();
            }
          });
        },
        { acceleratePort: 54020, databasePort: 54021, shadowDatabasePort: 54022 },
      );
    },
    timeouts.spinUpPpgDev,
  );
});
