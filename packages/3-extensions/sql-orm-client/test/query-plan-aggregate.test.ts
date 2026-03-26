import {
  AggregateExpr,
  AndExpr,
  BinaryExpr,
  type BoundWhereExpr,
  ColumnRef,
  ExistsExpr,
  ListLiteralExpr,
  LiteralExpr,
  NullCheckExpr,
  OrExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { compileAggregate, compileGroupedAggregate } from '../src/query-plan';
import { bindWhereExpr } from '../src/where-binding';
import { baseContract } from './collection-fixtures';

describe('query plan aggregate', () => {
  const filteredViews: BoundWhereExpr = {
    expr: bindWhereExpr(
      baseContract,
      BinaryExpr.gte(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)),
    ).expr,
  };

  it('rejects empty aggregate specs and selectors without required fields', () => {
    expect(() => compileAggregate(baseContract, 'posts', [], {})).toThrow(
      'aggregate() requires at least one aggregation selector',
    );
    expect(() =>
      compileAggregate(baseContract, 'posts', [], {
        totalViews: { kind: 'aggregate', fn: 'sum' },
      }),
    ).toThrow('Aggregate selector "sum" requires a field');

    expect(() =>
      compileGroupedAggregate(
        baseContract,
        'posts',
        [],
        [],
        {
          totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' },
        },
        undefined,
      ),
    ).toThrow('groupBy() requires at least one field');

    expect(() =>
      compileGroupedAggregate(baseContract, 'posts', [], ['user_id'], {}, undefined),
    ).toThrow('groupBy().aggregate() requires at least one aggregation selector');
  });

  it('validates grouped having expressions before lowering them', () => {
    const scalarSubquery = SelectAst.from(TableSource.named('posts')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('posts', 'id')),
    ]);

    expect(() =>
      compileGroupedAggregate(
        baseContract,
        'posts',
        [],
        ['user_id'],
        { totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' } },
        BinaryExpr.gte(
          AggregateExpr.sum(ColumnRef.of('posts', 'views')),
          ParamRef.of(1, { name: 'views', codecId: 'pg/int4@1' }),
        ),
      ),
    ).toThrow('ParamRef is not supported in grouped having expressions');

    expect(() =>
      compileGroupedAggregate(
        baseContract,
        'posts',
        [],
        ['user_id'],
        { totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' } },
        BinaryExpr.in(
          AggregateExpr.sum(ColumnRef.of('posts', 'views')),
          ListLiteralExpr.of([ParamRef.of(1, { name: 'views', codecId: 'pg/int4@1' })]),
        ),
      ),
    ).toThrow('ParamRef is not supported in grouped having expressions');

    expect(() =>
      compileGroupedAggregate(
        baseContract,
        'posts',
        [],
        ['user_id'],
        { totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' } },
        ExistsExpr.exists(scalarSubquery),
      ),
    ).toThrow('Unsupported grouped having expression kind "ExistsExpr"');

    expect(() =>
      compileGroupedAggregate(
        baseContract,
        'posts',
        [],
        ['user_id'],
        { totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' } },
        NullCheckExpr.isNull(ColumnRef.of('posts', 'views')),
      ),
    ).toThrow('groupBy().having() only supports aggregate metric expressions');
  });

  it('keeps grouped aggregate HAVING expressions composed from aggregate metrics', () => {
    const plan = compileGroupedAggregate(
      baseContract,
      'posts',
      [],
      ['user_id'],
      {
        postCount: { kind: 'aggregate', fn: 'count' },
        totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' },
      },
      AndExpr.of([
        BinaryExpr.in(
          AggregateExpr.sum(ColumnRef.of('posts', 'views')),
          ListLiteralExpr.fromValues([1, 2]),
        ),
        NullCheckExpr.isNotNull(AggregateExpr.sum(ColumnRef.of('posts', 'views'))),
      ]),
    );

    expect(plan.ast.kind).toBe('select');
    const ast = plan.ast as SelectAst;
    expect(ast.groupBy).toEqual([ColumnRef.of('posts', 'user_id')]);
    expect(ast.having).toEqual(
      AndExpr.of([
        BinaryExpr.in(
          AggregateExpr.sum(ColumnRef.of('posts', 'views')),
          ListLiteralExpr.of([LiteralExpr.of(1), LiteralExpr.of(2)]),
        ),
        NullCheckExpr.isNotNull(AggregateExpr.sum(ColumnRef.of('posts', 'views'))),
      ]),
    );
  });

  it('keeps grouped aggregate HAVING with OR expressions', () => {
    const plan = compileGroupedAggregate(
      baseContract,
      'posts',
      [],
      ['user_id'],
      {
        postCount: { kind: 'aggregate', fn: 'count' },
        totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' },
      },
      OrExpr.of([
        BinaryExpr.gte(
          AggregateExpr.sum(ColumnRef.of('posts', 'views')),
          ColumnRef.of('posts', 'views'),
        ),
        BinaryExpr.gte(AggregateExpr.count(), LiteralExpr.of(5)),
      ]),
    );

    expect(plan.ast.kind).toBe('select');
    const ast = plan.ast as SelectAst;
    expect(ast.having).toBeInstanceOf(OrExpr);
  });

  it('keeps aggregate filters and params when lowering plain aggregate queries', () => {
    const plan = compileAggregate(baseContract, 'posts', [filteredViews], {
      totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' },
    });

    expect(plan.ast.kind).toBe('select');
    const ast = plan.ast as SelectAst;
    expect(ast.where).toEqual(filteredViews.expr);
    expect(plan.params).toEqual([100]);
    expect(plan.meta.paramDescriptors).toEqual([
      {
        name: 'views',
        source: 'dsl',
        codecId: 'pg/int4@1',
        nativeType: 'int4',
      },
    ]);
  });
});
