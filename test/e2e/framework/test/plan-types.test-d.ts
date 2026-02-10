import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Varchar } from '@prisma-next/adapter-postgres/codec-types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { sql } from '@prisma-next/sql-lane/sql';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
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

  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const tables = schema<Contract>(context).tables;
  const user = tables.user!;
  const plan = sql({ context })
    .from(user)
    .select({ id: user.columns.id!, email: user.columns.email! })
    .build();

  type Row = ResultType<typeof plan>;
  expectTypeOf<Row['id']>().toEqualTypeOf<Contract['models']['User']['fields']['id']>();
  expectTypeOf<Row['email']>().toEqualTypeOf<Contract['models']['User']['fields']['email']>();
  void plan; // Used as a type in ResultType<typeof plan>
});

test('parameterized varchar uses branded type', () => {
  type Email = Contract['models']['User']['fields']['email'];
  expectTypeOf<Email>().toEqualTypeOf<Varchar<255>>();
  expectTypeOf<Email>().not.toEqualTypeOf<string>();
});
