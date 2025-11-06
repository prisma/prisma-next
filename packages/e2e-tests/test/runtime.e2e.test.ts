import { describe, it, expect } from 'vitest';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import {
  createRuntime,
  ensureSchemaStatement,
  ensureTableStatement,
  writeContractMarker,
} from '@prisma-next/runtime';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres';
import { sql } from '@prisma-next/sql-query/sql';
import { schema, validateContract } from '@prisma-next/sql-query/schema';
import type { ResultType } from '@prisma-next/sql-query/types';
import { withDevDatabase, executeStatement } from '@prisma-next/runtime/test/utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../../..');

const execFileAsync = promisify(execFile);

describe('end-to-end query with emitted contract', { timeout: 30000 }, () => {
  const adapterPath = resolve(repoRoot, 'packages/adapter-postgres');
  const cliPath = resolve(repoRoot, 'packages/cli/dist/cli.js');
  const contractTsPath = resolve(__dirname, 'fixtures/contract.ts');

  it('returns multiple rows with correct types', async () => {
    // 1) Emit contract via CLI to temp output folder under package
    const outputDir = resolve(__dirname, '../.tmp-output');
    await execFileAsync('node', [
      cliPath,
      'emit',
      '--contract',
      contractTsPath,
      '--out',
      outputDir,
      '--adapter',
      adapterPath,
    ]);

    const contractJsonPath = join(outputDir, 'contract.json');
    const contractJsonContent = await readFile(contractJsonPath, 'utf-8');
    const contractJson = JSON.parse(contractJsonContent);
    const contract = validateContract(contractJson);

    // 2) Start dev DB and prepare schema/data
    await withDevDatabase(
      async ({ connectionString }) => {
        const client = new Client({ connectionString });
        await client.connect();
        try {
          await client.query('drop schema if exists prisma_contract cascade');
          await client.query('create schema if not exists public');
          await client.query('drop table if exists "user"');
          await client.query('create table "user" (id serial primary key, email text not null)');
          await client.query('insert into "user" (email) values ($1), ($2), ($3)', [
            'ada@example.com',
            'tess@example.com',
            'mike@example.com',
          ]);

          await executeStatement(client, ensureSchemaStatement);
          await executeStatement(client, ensureTableStatement);
          const write = writeContractMarker({
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
            contractJson: contract,
            canonicalVersion: 1,
          });
          await executeStatement(client, write.insert);

          // 3) Build plan and execute via runtime
          const adapter = createPostgresAdapter();
          const driver = createPostgresDriverFromOptions({
            connect: { client },
            cursor: { disabled: true },
          });
          const runtime = createRuntime({
            contract,
            adapter,
            driver,
            verify: { mode: 'onFirstUse', requireMarker: true },
          });

          const tables = schema<typeof contract, CodecTypes>(contract).tables;
          const user = tables['user']!;
          const plan = sql<typeof contract, CodecTypes>({ contract, adapter })
            .from(user)
            .select({ id: user.columns['id']!, email: user.columns['email']! })
            .build();

          type Row = ResultType<typeof plan>;
          const rows: Row[] = [];
          for await (const row of runtime.execute(plan)) {
            rows.push(row);
          }

          expect(rows.length).toBeGreaterThan(1);
          expect(rows[0]).toHaveProperty('id');
          expect(rows[0]).toHaveProperty('email');

          // Type sanity at runtime
          expect(typeof rows[0]!.id).toBe('number');
          expect(typeof rows[0]!.email).toBe('string');

          await runtime.close();
        } finally {
          await client.end();
        }
      },
      { acceleratePort: 54020, databasePort: 54021, shadowDatabasePort: 54022 },
    );
  });
});
