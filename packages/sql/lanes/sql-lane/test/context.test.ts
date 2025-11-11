import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
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
  it('creates SqlContext from RuntimeContext', () => {
    const contract = loadContract('contract');
    const adapter = createStubAdapter();
    const runtimeContext = createTestContext(contract, adapter);

    const sqlContext = createSqlContext(runtimeContext);

    expect(sqlContext).toHaveProperty('context');
    expect(sqlContext).toHaveProperty('contract');
    expect(sqlContext).toHaveProperty('adapter');
    expect(sqlContext.context).toBe(runtimeContext);
    expect(sqlContext.contract).toBe(contract);
    expect(sqlContext.adapter).toBe(adapter);
  });

  it('preserves contract reference', () => {
    const contract = loadContract('contract');
    const adapter = createStubAdapter();
    const runtimeContext = createTestContext(contract, adapter);

    const sqlContext = createSqlContext(runtimeContext);

    expect(sqlContext.contract).toBe(contract);
    expect(sqlContext.contract.storage.tables).toBe(contract.storage.tables);
  });

  it('preserves adapter reference', () => {
    const contract = loadContract('contract');
    const adapter = createStubAdapter();
    const runtimeContext = createTestContext(contract, adapter);

    const sqlContext = createSqlContext(runtimeContext);

    expect(sqlContext.adapter).toBe(adapter);
  });
});
