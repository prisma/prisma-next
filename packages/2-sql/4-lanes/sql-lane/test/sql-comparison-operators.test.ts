import {
  BinaryExpr,
  ColumnRef,
  type DeleteAst,
  NullCheckExpr,
  ParamRef,
  SelectAst,
  type UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ExecutionContext } from '@prisma-next/sql-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';
import type { CodecTypes, Contract } from './fixtures/contract.d';
import { createFixtureContext, loadFixtureContract } from './test-helpers';

describe('sql comparison operators', () => {
  let context: ExecutionContext<Contract>;
  let tables: ReturnType<typeof schema<Contract>>['tables'];

  beforeEach(() => {
    const contract = loadFixtureContract<Contract>('contract');
    context = createFixtureContext(contract);
    tables = schema<Contract>(context).tables;
  });

  it.each([
    { op: 'gt', method: 'gt', paramName: 'minId', paramValue: 10 },
    { op: 'lt', method: 'lt', paramName: 'maxId', paramValue: 100 },
    { op: 'gte', method: 'gte', paramName: 'minId', paramValue: 10 },
    { op: 'lte', method: 'lte', paramName: 'maxId', paramValue: 100 },
    { op: 'neq', method: 'neq', paramName: 'userId', paramValue: 5 },
  ] as const)('builds query with $op filters', ({ op, method, paramName, paramValue }) => {
    const { id, email } = tables.user.columns;

    const plan = sql<Contract, CodecTypes>({ context })
      .from(tables.user)
      .select({ id, email })
      .where(id[method](param(paramName)))
      .build({ params: { [paramName]: paramValue } });

    expect(plan.ast).toBeInstanceOf(SelectAst);
    expect((plan.ast as SelectAst).where).toEqual(
      new BinaryExpr(op, ColumnRef.of('user', 'id'), ParamRef.of(1, paramName)),
    );
  });

  it.each([
    { op: 'eq', method: 'eq' },
    { op: 'neq', method: 'neq' },
    { op: 'gt', method: 'gt' },
    { op: 'lt', method: 'lt' },
    { op: 'gte', method: 'gte' },
    { op: 'lte', method: 'lte' },
  ] as const)('builds column-to-column %s comparisons', ({ op, method }) => {
    const { id, createdAt } = tables.user.columns;
    const expected = new BinaryExpr(
      op,
      ColumnRef.of('user', 'id'),
      ColumnRef.of('user', 'createdAt'),
    );

    expect(
      (
        sql({ context }).from(tables.user).select({ id }).where(id[method](createdAt)).build()
          .ast as SelectAst
      ).where,
    ).toEqual(expected);
    expect(
      (
        sql({ context })
          .update(tables.user, { email: param('email') })
          .where(id[method](createdAt))
          .build({ params: { email: 'x' } }).ast as UpdateAst
      ).where,
    ).toEqual(expected);
    expect(
      (sql({ context }).delete(tables.user).where(id[method](createdAt)).build().ast as DeleteAst)
        .where,
    ).toEqual(expected);
  });

  it('builds nullable predicates as null-check AST nodes', () => {
    const { id, deletedAt } = tables.user.columns;

    expect(
      (
        sql({ context }).from(tables.user).select({ id }).where(deletedAt.isNull()).build()
          .ast as SelectAst
      ).where,
    ).toEqual(NullCheckExpr.isNull(ColumnRef.of('user', 'deletedAt')));
    expect(
      (sql({ context }).delete(tables.user).where(deletedAt.isNotNull()).build().ast as DeleteAst)
        .where,
    ).toEqual(NullCheckExpr.isNotNull(ColumnRef.of('user', 'deletedAt')));
  });

  it('rejects invalid comparison values', () => {
    const { id } = tables.user.columns;

    expect(() => (id as { eq: (value: unknown) => unknown }).eq({ kind: 'invalid' })).toThrow(
      'Parameter placeholder or expression source required for column comparison',
    );
    expect(() => (id as { eq: (value: unknown) => unknown }).eq(null)).toThrow(
      'Parameter placeholder or expression source required for column comparison',
    );
  });
});
