import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '@prisma-next/sql-lane/sql';
import { executePlanAndCollect } from '@prisma-next/sql-runtime/test/utils';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { emitAndVerifyContract, withTestRuntime } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
describe('end-to-end basic queries', () => {
  const configPath = resolve(__dirname, 'fixtures/prisma-next.config.ts');
  const cliPath = resolve(__dirname, '../../../../packages/1-framework/3-tooling/cli/dist/cli.js');
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
      await withTestRuntime<Contract>(
        contractJsonPath,
        async ({ tables, runtime, context, client }) => {
          await client.query('insert into "user" (email) values ($1), ($2), ($3)', [
            'ada@example.com',
            'tess@example.com',
            'mike@example.com',
          ]);

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
        },
      );
    },
    timeouts.spinUpPpgDev,
  );
});
