import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';
import { createSqlContext } from '../src/sql/context';
import type { Contract } from './fixtures/contract.d';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): Contract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<Contract>(contractJson);
}

describe('createSqlContext', () => {
  it('creates SqlContext from ExecutionContext', () => {
    const contract = loadContract('contract');
    const adapter = createStubAdapter();
    const runtimeContext = createTestContext(contract, adapter);

    const sqlContext = createSqlContext(runtimeContext);

    expect(sqlContext).toHaveProperty('contract');
    expect(sqlContext).toHaveProperty('operations');
    expect(sqlContext).toHaveProperty('codecs');
    expect(sqlContext.contract).toBe(contract);
    expect(sqlContext).toBe(runtimeContext);
  });

  it('preserves contract reference', () => {
    const contract = loadContract('contract');
    const adapter = createStubAdapter();
    const runtimeContext = createTestContext(contract, adapter);

    const sqlContext = createSqlContext(runtimeContext);

    expect(sqlContext.contract).toBe(contract);
    expect(sqlContext.contract.storage.tables).toBe(contract.storage.tables);
  });

  it('preserves operations and codecs references', () => {
    const contract = loadContract('contract');
    const adapter = createStubAdapter();
    const runtimeContext = createTestContext(contract, adapter);

    const sqlContext = createSqlContext(runtimeContext);

    expect(sqlContext.operations).toBe(runtimeContext.operations);
    expect(sqlContext.codecs).toBe(runtimeContext.codecs);
  });

  it('builds plan when contract has no runtime codecTypes or operationTypes', () => {
    const contract = loadContract('contract');
    expect(contract.mappings).not.toHaveProperty('codecTypes');
    expect(contract.mappings).not.toHaveProperty('operationTypes');

    const adapter = createStubAdapter();
    const runtimeContext = createTestContext(contract, adapter);
    createSqlContext(runtimeContext);

    const tables = schema(runtimeContext).tables;
    const userTable = tables.user!;

    const plan = sql({ context: runtimeContext })
      .from(userTable)
      .select({
        id: userTable.columns.id!,
        email: userTable.columns.email!,
      })
      .build();

    expect(plan).toMatchObject({
      ast: expect.anything(),
      params: expect.anything(),
      meta: expect.anything(),
    });
  });
});
