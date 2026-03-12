import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  DerivedTableSource,
  JoinAst,
  JsonArrayAggExpr,
  type JsonObjectExpr,
  type SelectAst,
} from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';
import type { CodecTypes, Contract } from './fixtures/contract-with-relations.d';
import { createFixtureContext, loadFixtureContract } from './test-helpers';

describe('SQL builder includeMany', () => {
  const contract = loadFixtureContract<Contract>('contract-with-relations');
  const context = createFixtureContext(contract);
  const tables = schema<Contract>(context).tables;

  it('builds includeMany with the default alias', () => {
    const plan = sql<Contract, CodecTypes>({ context })
      .from(tables.user)
      .includeMany(
        tables.post,
        (on) => on.eqCol(tables.user.columns.id, tables.post.columns.userId),
        (child) => child.select({ id: tables.post.columns.id, title: tables.post.columns.title }),
      )
      .select({
        id: tables.user.columns.id,
        post: true,
      })
      .build();

    const ast = plan.ast as SelectAst;
    const includeJoin = ast.joins?.find(
      (join) =>
        join.lateral &&
        join.source instanceof DerivedTableSource &&
        join.source.alias === 'post_lateral',
    );

    expect(includeJoin).toBeInstanceOf(JoinAst);
    expect(ast.project.find((item) => item.alias === 'post')?.expr).toEqual(
      ColumnRef.of('post_lateral', 'post'),
    );
    const includeProjection = (includeJoin?.source as DerivedTableSource).query.project[0];
    expect(includeProjection?.expr).toBeInstanceOf(JsonArrayAggExpr);
  });

  it('builds includeMany with custom aliases and child where clauses', () => {
    const plan = sql<Contract, CodecTypes>({ context })
      .from(tables.user)
      .includeMany(
        tables.post,
        (on) => on.eqCol(tables.user.columns.id, tables.post.columns.userId),
        (child) =>
          child
            .select({ id: tables.post.columns.id, title: tables.post.columns.title })
            .where(tables.post.columns.title.eq(param('title'))),
        { alias: 'posts' },
      )
      .select({
        id: tables.user.columns.id,
        posts: true,
      })
      .build({ params: { title: 'Test' } });

    const includeJoin = (plan.ast as SelectAst).joins?.find(
      (join) =>
        join.lateral &&
        join.source instanceof DerivedTableSource &&
        join.source.alias === 'posts_lateral',
    );
    const rowsQuery = ((includeJoin?.source as DerivedTableSource).query.from as DerivedTableSource)
      .query;

    expect(rowsQuery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('user', 'id'), ColumnRef.of('post', 'userId')),
        BinaryExpr.eq(ColumnRef.of('post', 'title'), { index: 1, name: 'title' } as never),
      ]),
    );
  });

  it('propagates child orderBy and limit into the rows subquery', () => {
    const plan = sql<Contract, CodecTypes>({ context })
      .from(tables.user)
      .includeMany(
        tables.post,
        (on) => on.eqCol(tables.user.columns.id, tables.post.columns.userId),
        (child) =>
          child
            .select({ id: tables.post.columns.id, title: tables.post.columns.title })
            .orderBy(tables.post.columns.createdAt.desc())
            .limit(2),
        { alias: 'posts' },
      )
      .select({
        id: tables.user.columns.id,
        posts: true,
      })
      .build();

    const aggregateSelect = ((plan.ast as SelectAst).joins?.[0]?.source as DerivedTableSource)
      .query;
    const rowsQuery = (aggregateSelect.from as DerivedTableSource).query;
    const aggregateExpr = aggregateSelect.project[0]?.expr as JsonArrayAggExpr;

    expect(rowsQuery.limit).toBe(2);
    expect(rowsQuery.orderBy?.[0]?.expr).toEqual(ColumnRef.of('post', 'createdAt'));
    expect(aggregateExpr.orderBy?.[0]?.expr).toEqual(ColumnRef.of('posts__rows', 'posts__order_0'));
    expect((aggregateExpr.expr as JsonObjectExpr).entries.map((entry) => entry.key)).toEqual([
      'id',
      'title',
    ]);
  });
});
