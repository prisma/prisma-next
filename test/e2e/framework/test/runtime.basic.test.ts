import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createTestRuntimeFromClient,
  setupE2EDatabase,
} from '@prisma-next/integration-tests/test/utils';
import { sql } from '@prisma-next/sql-lane/sql';
import { schema } from '@prisma-next/sql-relational-core/schema';
import {
  createStubAdapter,
  createTestContext,
  executePlanAndCollect,
} from '@prisma-next/sql-runtime/test/utils';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d.ts';
import { emitAndVerifyContract, loadContractFromDisk } from './utils.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../../../../');

describe('end-to-end basic queries', () => {
  const configPath = resolve(__dirname, 'fixtures/prisma-next.config.ts');
  const cliPath = resolve(repoRoot, 'packages/1-framework/3-tooling/cli/dist/cli.js');
  const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

  it(
    'emits contract and verifies it matches on-disk artifacts',
    async () => {
      await emitAndVerifyContract(cliPath, configPath, contractJsonPath);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'returns multiple rows with correct types',
    async () => {
      const contract = await loadContractFromDisk<Contract>(contractJsonPath);

      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          await setupE2EDatabase(client, contract, async (c) => {
            await c.query('drop table if exists "user"');
            await c.query('create table "user" (id serial primary key, email text not null)');
            await c.query('insert into "user" (email) values ($1), ($2), ($3)', [
              'ada@example.com',
              'tess@example.com',
              'mike@example.com',
            ]);
          });

          const adapter = createStubAdapter();
          const context = createTestContext(contract, adapter);
          const runtime = createTestRuntimeFromClient(contract, client);
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
      });
    },
    timeouts.spinUpPpgDev,
  );
});
