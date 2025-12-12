import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { createColumnRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
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
  const contract = loadContract('contract');
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const tables = schema<Contract>(context).tables;

  describe('gt operator', () => {
    it('builds query with gt filter', () => {
      const { id, email } = tables.user.columns;

      const plan = sql({ context })
        .from(tables.user)
        .select({ id, email })
        .where(id.gt(param('minId')))
        .build({ params: { minId: 10 } });

      expect(plan.ast).toMatchObject({
        kind: 'select',
        where: {
          kind: 'bin',
          op: 'gt',
          left: createColumnRef('user', 'id'),
        },
      });
    });
  });

  describe('lt operator', () => {
    it('builds query with lt filter', () => {
      const { id, email } = tables.user.columns;

      const plan = sql({ context })
        .from(tables.user)
        .select({ id, email })
        .where(id.lt(param('maxId')))
        .build({ params: { maxId: 100 } });

      expect(plan.ast).toMatchObject({
        kind: 'select',
        where: {
          kind: 'bin',
          op: 'lt',
          left: createColumnRef('user', 'id'),
        },
      });
    });
  });

  describe('gte operator', () => {
    it('builds query with gte filter', () => {
      const { id, email } = tables.user.columns;

      const plan = sql({ context })
        .from(tables.user)
        .select({ id, email })
        .where(id.gte(param('minId')))
        .build({ params: { minId: 10 } });

      expect(plan.ast).toMatchObject({
        kind: 'select',
        where: {
          kind: 'bin',
          op: 'gte',
          left: createColumnRef('user', 'id'),
        },
      });
    });
  });

  describe('lte operator', () => {
    it('builds query with lte filter', () => {
      const { id, email } = tables.user.columns;

      const plan = sql({ context })
        .from(tables.user)
        .select({ id, email })
        .where(id.lte(param('maxId')))
        .build({ params: { maxId: 100 } });

      expect(plan.ast).toMatchObject({
        kind: 'select',
        where: {
          kind: 'bin',
          op: 'lte',
          left: createColumnRef('user', 'id'),
        },
      });
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
});
