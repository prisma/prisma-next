import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { ResultType } from '@prisma-next/contract/types';
import { schema, validateContract } from '@prisma-next/sql-query/schema';
import { sql } from '@prisma-next/sql-query/sql';
import { createRuntimeContext } from '@prisma-next/sql-runtime';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('inferred row types are correct', () => {
  const outputDir = resolve(__dirname, 'fixtures/generated');
  const contractJson = JSON.parse(
    readFileSync(join(outputDir, 'contract.json'), 'utf-8'),
  ) as Record<string, unknown>;
  const contract = validateContract<Contract>(contractJson);

  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [] });
  const tables = schema<Contract>(context).tables;
  const user = tables.user!;
  const plan = sql({ context })
    .from(user)
    .select({ id: user.columns.id!, email: user.columns.email! })
    .build();

  type Row = ResultType<typeof plan>;
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();
  void plan; // Used as a type in ResultType<typeof plan>
});
