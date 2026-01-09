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
      }).toThrow('Parameter placeholder or expression source required for column comparison');
    });
  });

  describe('neq operator', () => {
    it('throws error when column.neq() is called with invalid value', () => {
      const { id } = tables.user.columns;

      expect(() => {
        // @ts-expect-error testing invalid input
        id.neq({ kind: 'invalid' });
      }).toThrow('Parameter placeholder or expression source required for column comparison');
    });
  });

  describe('column-to-column comparisons', () => {
    it.each([
      { op: 'eq', method: 'eq' },
      { op: 'neq', method: 'neq' },
      { op: 'gt', method: 'gt' },
      { op: 'lt', method: 'lt' },
      { op: 'gte', method: 'gte' },
      { op: 'lte', method: 'lte' },
    ] as const)('builds query with $op filter using column reference', ({ op, method }) => {
      const { id, createdAt } = tables.user.columns;

      const plan = sql({ context })
        .from(tables.user)
        .select({ id })
        .where(id[method](createdAt))
        .build();

      expect(plan.ast).toMatchObject({
        kind: 'select',
        where: {
          kind: 'bin',
          op,
          left: createColumnRef('user', 'id'),
          right: createColumnRef('user', 'createdAt'),
        },
      });
    });

    it('builds query with column-to-column comparison in WHERE clause', () => {
      const { id, createdAt } = tables.user.columns;

      const plan = sql({ context })
        .from(tables.user)
        .select({ id })
        .where(id.eq(createdAt))
        .build();

      expect(plan.ast).toMatchObject({
        kind: 'select',
        where: {
          kind: 'bin',
          op: 'eq',
          left: createColumnRef('user', 'id'),
          right: createColumnRef('user', 'createdAt'),
        },
      });
    });

    it('builds UPDATE query with column-to-column comparison in WHERE clause', () => {
      const { id, createdAt } = tables.user.columns;

      const plan = sql({ context })
        .update(tables.user, { email: param('email') })
        .where(id.eq(createdAt))
        .build({ params: { email: 'test@example.com' } });

      expect(plan.ast).toMatchObject({
        kind: 'update',
        where: {
          kind: 'bin',
          op: 'eq',
          left: createColumnRef('user', 'id'),
          right: createColumnRef('user', 'createdAt'),
        },
      });
    });

    it('builds DELETE query with column-to-column comparison in WHERE clause', () => {
      const { id, createdAt } = tables.user.columns;

      const plan = sql({ context }).delete(tables.user).where(id.eq(createdAt)).build();

      expect(plan.ast).toMatchObject({
        kind: 'delete',
        where: {
          kind: 'bin',
          op: 'eq',
          left: createColumnRef('user', 'id'),
          right: createColumnRef('user', 'createdAt'),
        },
      });
    });

    it('throws error when column comparison is called with invalid value', () => {
      const { id } = tables.user.columns;

      expect(() => {
        (id as { eq: (value: unknown) => unknown }).eq({ kind: 'invalid' } as unknown);
      }).toThrow('Parameter placeholder or expression source required for column comparison');
    });

    it('throws error when column comparison is called with null', () => {
      const { id } = tables.user.columns;

      expect(() => {
        (id as { eq: (value: unknown) => unknown }).eq(null as unknown);
      }).toThrow('Parameter placeholder or expression source required for column comparison');
    });

    it('throws error when column comparison is called with undefined', () => {
      const { id } = tables.user.columns;

      expect(() => {
        (id as { eq: (value: unknown) => unknown }).eq(undefined as unknown);
      }).toThrow('Parameter placeholder or expression source required for column comparison');
    });
  });

  describe('isNull operator', () => {
    it('builds SELECT query with isNull filter on nullable column', () => {
      const { id, deletedAt } = tables.user.columns;

      const plan = sql({ context })
        .from(tables.user)
        .select({ id })
        .where(deletedAt.isNull())
        .build();

      expect(plan.ast).toMatchObject({
        kind: 'select',
        where: {
          kind: 'nullCheck',
          expr: createColumnRef('user', 'deletedAt'),
          isNull: true,
        },
      });
    });

    it('builds UPDATE query with isNull filter on nullable column', () => {
      const { deletedAt } = tables.user.columns;

      const plan = sql({ context })
        .update(tables.user, { email: param('email') })
        .where(deletedAt.isNull())
        .build({ params: { email: 'test@example.com' } });

      expect(plan.ast).toMatchObject({
        kind: 'update',
        where: {
          kind: 'nullCheck',
          expr: createColumnRef('user', 'deletedAt'),
          isNull: true,
        },
      });
    });

    it('builds DELETE query with isNull filter on nullable column', () => {
      const { deletedAt } = tables.user.columns;

      const plan = sql({ context }).delete(tables.user).where(deletedAt.isNull()).build();

      expect(plan.ast).toMatchObject({
        kind: 'delete',
        where: {
          kind: 'nullCheck',
          expr: createColumnRef('user', 'deletedAt'),
          isNull: true,
        },
      });
    });
  });

  describe('isNotNull operator', () => {
    it('builds SELECT query with isNotNull filter on nullable column', () => {
      const { id, deletedAt } = tables.user.columns;

      const plan = sql({ context })
        .from(tables.user)
        .select({ id })
        .where(deletedAt.isNotNull())
        .build();

      expect(plan.ast).toMatchObject({
        kind: 'select',
        where: {
          kind: 'nullCheck',
          expr: createColumnRef('user', 'deletedAt'),
          isNull: false,
        },
      });
    });

    it('builds UPDATE query with isNotNull filter on nullable column', () => {
      const { deletedAt } = tables.user.columns;

      const plan = sql({ context })
        .update(tables.user, { email: param('email') })
        .where(deletedAt.isNotNull())
        .build({ params: { email: 'test@example.com' } });

      expect(plan.ast).toMatchObject({
        kind: 'update',
        where: {
          kind: 'nullCheck',
          expr: createColumnRef('user', 'deletedAt'),
          isNull: false,
        },
      });
    });

    it('builds DELETE query with isNotNull filter on nullable column', () => {
      const { deletedAt } = tables.user.columns;

      const plan = sql({ context }).delete(tables.user).where(deletedAt.isNotNull()).build();

      expect(plan.ast).toMatchObject({
        kind: 'delete',
        where: {
          kind: 'nullCheck',
          expr: createColumnRef('user', 'deletedAt'),
          isNull: false,
        },
      });
    });
  });

  describe('isNull/isNotNull type safety', () => {
    it('isNull is only available on nullable columns at the type level', () => {
      const { id, deletedAt } = tables.user.columns;

      // Non-nullable column should not have isNull method at type level
      // @ts-expect-error - id is not nullable, so isNull should not exist
      expect(typeof id.isNull).toBe('function');

      // Nullable column should have isNull method
      expect(typeof deletedAt.isNull).toBe('function');
    });

    it('isNotNull is only available on nullable columns at the type level', () => {
      const { id, deletedAt } = tables.user.columns;

      // Non-nullable column should not have isNotNull method at type level
      // @ts-expect-error - id is not nullable, so isNotNull should not exist
      expect(typeof id.isNotNull).toBe('function');

      // Nullable column should have isNotNull method
      expect(typeof deletedAt.isNotNull).toBe('function');
    });
  });
});
