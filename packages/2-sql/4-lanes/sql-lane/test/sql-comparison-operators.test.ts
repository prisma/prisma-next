import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { createColumnRef, createParamRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { RuntimeContext } from '@prisma-next/sql-runtime';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';
import type { Contract } from './fixtures/contract.d';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): Contract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<Contract>(contractJson);
}

describe('sql comparison operators', () => {
  let context: RuntimeContext<Contract>;
  let tables: ReturnType<typeof schema<Contract>>['tables'];

  beforeEach(() => {
    const contract = loadContract('contract');
    const adapter = createStubAdapter();
    context = createTestContext(contract, adapter);
    tables = schema<Contract>(context).tables;
  });

  it.each([
    { op: 'gt', method: 'gt', paramName: 'minId', paramValue: 10 },
    { op: 'lt', method: 'lt', paramName: 'maxId', paramValue: 100 },
    { op: 'gte', method: 'gte', paramName: 'minId', paramValue: 10 },
    { op: 'lte', method: 'lte', paramName: 'maxId', paramValue: 100 },
    { op: 'neq', method: 'neq', paramName: 'userId', paramValue: 5 },
  ] as const)('builds query with $op filter', ({ op, method, paramName, paramValue }) => {
    const { id, email } = tables.user.columns;

    const plan = sql({ context })
      .from(tables.user)
      .select({ id, email })
      .where(id[method](param(paramName)))
      .build({ params: { [paramName]: paramValue } });

    expect(plan.ast).toMatchObject({
      kind: 'select',
      where: {
        kind: 'bin',
        op,
        left: createColumnRef('user', 'id'),
        right: createParamRef(1, paramName),
      },
    });
  });

  describe('eq operator', () => {
    it('throws error when column.eq() is called with invalid value', () => {
      const { id } = tables.user.columns;

      expect(() => {
        (id as { eq: (value: unknown) => unknown }).eq({ kind: 'invalid' } as unknown);
      }).toThrow('Parameter placeholder required for column comparison');
    });
  });

  describe('neq operator', () => {
    it('throws error when column.neq() is called with invalid value', () => {
      const { id } = tables.user.columns;

      expect(() => {
        // @ts-expect-error testing invalid input
        id.neq({ kind: 'invalid' });
      }).toThrow('Parameter placeholder required for column comparison');
    });
  });
});
