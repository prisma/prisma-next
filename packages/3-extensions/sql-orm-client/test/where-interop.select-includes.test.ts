import {
  BinaryExpr,
  type BoundWhereExpr,
  ColumnRef,
  DerivedTableSource,
  ExistsExpr,
  JoinAst,
  LiteralExpr,
  NullCheckExpr,
  OperationExpr,
  OrderByItem,
  ParamRef,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
  type ToWhereExpr,
  type WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { normalizeWhereArg } from '../src/where-interop';

const col = (table: string, column: string) => ColumnRef.of(table, column);
const param = (index: number, name?: string) => ParamRef.of(index, name);
const literal = (value: unknown) => LiteralExpr.of(value);

function bound(
  expr: WhereExpr,
  params: readonly unknown[] = [],
  paramDescriptors = params.map((_, index) => ({ source: 'lane' as const, index: index + 1 })),
): BoundWhereExpr {
  return {
    expr,
    params: [...params],
    paramDescriptors,
  };
}

function toWhereExpr(expr: BoundWhereExpr): ToWhereExpr {
  return {
    toWhereExpr: () => expr,
  };
}

function op(self: ColumnRef, args: Array<ColumnRef | ParamRef | LiteralExpr>): OperationExpr {
  return new OperationExpr({
    method: 'op',
    forTypeId: 'sql/text@1',
    self,
    args,
    returns: {} as never,
    lowering: {} as never,
  });
}

describe('where interop select/source branches', () => {
  it('accepts bound payloads when ParamRef only appears inside select/source branches', () => {
    const select = SelectAst.from(
      DerivedTableSource.as(
        'users_src',
        SelectAst.from(TableSource.named('users'))
          .withProject([ProjectionItem.of('id', col('users', 'id'))])
          .withWhere(BinaryExpr.eq(col('users', 'kind'), param(1, 'kind'))),
      ),
    )
      .withProject([
        ProjectionItem.of('id', col('users_src', 'id')),
        ProjectionItem.of(
          'nested',
          SubqueryExpr.of(
            SelectAst.from(TableSource.named('posts')).withProject([
              ProjectionItem.of('title', op(col('posts', 'title'), [param(3, 'nested')])),
            ]),
          ),
        ),
      ])
      .withOrderBy([OrderByItem.desc(op(col('users_src', 'id'), [param(4, 'order')]))])
      .withJoins([
        JoinAst.inner(
          TableSource.named('posts'),
          BinaryExpr.eq(col('users_src', 'id'), param(2, 'join')),
        ),
      ]);

    expect(
      normalizeWhereArg(
        toWhereExpr(
          bound(ExistsExpr.exists(select), ['srcWhere', 'joinOn', 'nestedProject', 'order']),
        ),
      ),
    ).toEqual(bound(ExistsExpr.exists(select), ['srcWhere', 'joinOn', 'nestedProject', 'order']));
  });

  it('preserves nullCheck expressions with operation args', () => {
    const expr = NullCheckExpr.isNotNull(
      op(col('users', 'email'), [col('users', 'email'), param(1, 'needle'), literal('x')]),
    );

    expect(normalizeWhereArg(toWhereExpr(bound(expr, ['needle'])))).toEqual(
      bound(expr, ['needle']),
    );
  });

  it('rejects bare exists expressions with params in derived branches', () => {
    const expr = ExistsExpr.exists(
      SelectAst.from(
        DerivedTableSource.as(
          'users_src',
          SelectAst.from(TableSource.named('users'))
            .withProject([ProjectionItem.of('id', col('users', 'id'))])
            .withWhere(BinaryExpr.eq(col('users', 'id'), param(1, 'id'))),
        ),
      ).withProject([ProjectionItem.of('id', col('users_src', 'id'))]),
    );

    expect(() => normalizeWhereArg(expr)).toThrow(/bare WhereExpr.*ParamRef/i);
  });

  it('rejects bare unsupported where nodes', () => {
    const bad = { kind: 'unsupported' } as unknown as WhereExpr;

    expect(() => normalizeWhereArg(bad)).toThrow();
  });

  it('accepts bare exists with literal and subquery projections when param-free', () => {
    const expr = ExistsExpr.exists(
      SelectAst.from(TableSource.named('users'))
        .withProject([
          ProjectionItem.of('id', col('users', 'id')),
          ProjectionItem.of('tag', literal('x')),
          ProjectionItem.of(
            'postId',
            SubqueryExpr.of(
              SelectAst.from(TableSource.named('posts')).withProject([
                ProjectionItem.of('id', col('posts', 'id')),
              ]),
            ),
          ),
        ])
        .withOrderBy([OrderByItem.asc(col('users', 'id'))]),
    );

    expect(normalizeWhereArg(expr)).toEqual(bound(expr));
  });

  it('rejects bare exists with params in top-level and nested subqueries', () => {
    const expr = ExistsExpr.exists(
      SelectAst.from(TableSource.named('users'))
        .withProject([
          ProjectionItem.of(
            'postId',
            SubqueryExpr.of(
              SelectAst.from(TableSource.named('posts')).withProject([
                ProjectionItem.of('id', op(col('posts', 'id'), [param(2, 'nested')])),
              ]),
            ),
          ),
        ])
        .withOrderBy([OrderByItem.asc(op(col('users', 'id'), [param(1, 'top')]))]),
    );

    expect(() => normalizeWhereArg(expr)).toThrow(/bare WhereExpr.*ParamRef/i);
  });
});
