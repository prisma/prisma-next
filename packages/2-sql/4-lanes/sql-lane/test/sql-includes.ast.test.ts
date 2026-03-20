import {
  BinaryExpr,
  ColumnRef,
  DerivedTableSource,
  JoinAst,
  JsonArrayAggExpr,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';

describe('include AST shapes', () => {
  it('represents lateral include aggregates as derived-table joins', () => {
    const includeAggregate = SelectAst.from(
      DerivedTableSource.as(
        'posts__rows',
        SelectAst.from(TableSource.named('post')).withProject([
          ProjectionItem.of('id', ColumnRef.of('post', 'id')),
        ]),
      ),
    ).withProject([
      ProjectionItem.of(
        'posts',
        JsonArrayAggExpr.of(ColumnRef.of('posts__rows', 'id'), 'emptyArray'),
      ),
    ]);

    const selectAst = SelectAst.from(TableSource.named('user'))
      .withProject([
        ProjectionItem.of('id', ColumnRef.of('user', 'id')),
        ProjectionItem.of('posts', ColumnRef.of('posts_lateral', 'posts')),
      ])
      .withJoins([
        JoinAst.left(
          DerivedTableSource.as('posts_lateral', includeAggregate),
          BinaryExpr.eq(ColumnRef.of('user', 'id'), ColumnRef.of('user', 'id')),
          true,
        ),
      ]);

    expect(selectAst.joins?.[0]?.lateral).toBe(true);
    expect(selectAst.joins?.[0]?.source).toBeInstanceOf(DerivedTableSource);
    expect(
      (selectAst.joins?.[0]?.source as DerivedTableSource).query.project[0]?.expr,
    ).toBeInstanceOf(JsonArrayAggExpr);
  });

  it('represents scalar include subqueries as subquery expressions', () => {
    const childQuery = SelectAst.from(TableSource.named('post'))
      .withProject([ProjectionItem.of('posts', ColumnRef.of('post', 'id'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'userId'), ColumnRef.of('user', 'id')));

    const selectAst = SelectAst.from(TableSource.named('user')).withProject([
      ProjectionItem.of('id', ColumnRef.of('user', 'id')),
      ProjectionItem.of('posts', SubqueryExpr.of(childQuery)),
    ]);

    expect(selectAst.project[1]?.expr).toBeInstanceOf(SubqueryExpr);
    expect((selectAst.project[1]?.expr as SubqueryExpr).query.where).toEqual(
      BinaryExpr.eq(ColumnRef.of('post', 'userId'), ColumnRef.of('user', 'id')),
    );
  });
});
