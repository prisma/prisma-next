import {
  ColumnRef,
  EqColJoinOn,
  JoinAst,
  type SelectAst,
} from '@prisma-next/sql-relational-core/ast';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';
import type { CodecTypes, Contract } from './fixtures/contract-with-relations.d';
import { createFixtureContext, loadFixtureContract } from './test-helpers';

describe('SQL join builder', () => {
  const contract = loadFixtureContract<Contract>('contract-with-relations');
  const context = createFixtureContext(contract);
  const tables = schema<Contract>(context).tables;

  it.each([
    ['innerJoin', 'inner'],
    ['leftJoin', 'left'],
    ['rightJoin', 'right'],
    ['fullJoin', 'full'],
  ] as const)('builds %s with eq-column ON predicates', (method, expectedJoinType) => {
    const plan = sql<Contract, CodecTypes>({ context })
      .from(tables.user)
      [method](tables.post, (on) => on.eqCol(tables.user.columns.id, tables.post.columns.userId))
      .select({
        user_id: tables.user.columns.id,
        post_title: tables.post.columns.title,
      })
      .build();

    const join = (plan.ast as SelectAst).joins?.[0];
    expect(join).toBeInstanceOf(JoinAst);
    expect(join?.joinType).toBe(expectedJoinType);
    expect(join?.on).toEqual(
      EqColJoinOn.of(ColumnRef.of('user', 'id'), ColumnRef.of('post', 'userId')),
    );
  });

  it('accumulates multiple joins and joined projections', () => {
    const plan = sql<Contract, CodecTypes>({ context })
      .from(tables.user)
      .innerJoin(tables.post, (on) => on.eqCol(tables.user.columns.id, tables.post.columns.userId))
      .select({
        user_id: tables.user.columns.id,
        post_title: tables.post.columns.title,
      })
      .build();

    expect((plan.ast as SelectAst).projection).toEqual([
      { alias: 'user_id', expr: ColumnRef.of('user', 'id') },
      { alias: 'post_title', expr: ColumnRef.of('post', 'title') },
    ]);
    expect(plan.meta.refs?.tables).toContain('post');
  });

  it('rejects unknown join tables and self-joins', () => {
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(tables.user)
        .innerJoin({ name: 'unknown' }, (on) =>
          on.eqCol(tables.user.columns.id, tables.post.columns.userId),
        )
        .select({ id: tables.user.columns.id })
        .build(),
    ).toThrow('Unknown table unknown');

    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(tables.user)
        .innerJoin(tables.user, (on) => on.eqCol(tables.user.columns.id, tables.user.columns.id))
        .select({ id: tables.user.columns.id })
        .build(),
    ).toThrow('Self-joins are not supported in MVP');
  });
});
