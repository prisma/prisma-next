import { expectTypeOf, test } from 'vitest';
import type { ResultType } from '@prisma-next/sql-query/types';
import { sql } from '@prisma-next/sql-query/sql';
import { schema } from '@prisma-next/sql-query/schema';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { Contract } from './fixtures/generated/contract.d';
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '@prisma-next/sql-query/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('inferred row types are correct', () => {
  const outputDir = resolve(__dirname, 'fixtures/generated');
  const contractJson = JSON.parse(readFileSync(join(outputDir, 'contract.json'), 'utf-8'));
  const contract = validateContract<Contract>(contractJson);

  const adapter = createPostgresAdapter();
  const tables = schema<Contract, CodecTypes>(contract).tables;
  const user = tables['user']!;
  const plan = sql<Contract, CodecTypes>({ contract, adapter })
    .from(user)
    .select({ id: user.columns['id']!, email: user.columns['email']! })
    .build();

  type Row = ResultType<typeof plan>;
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();
});
