import {
  AggregateExpr,
  AndExpr,
  BinaryExpr,
  ColumnRef,
  DerivedTableSource,
  EqColJoinOn,
  ExistsExpr,
  IdentifierRef,
  JoinAst,
  JsonArrayAggExpr,
  JsonObjectExpr,
  ListExpression,
  LiteralExpr,
  NotExpr,
  NullCheckExpr,
  OperationExpr,
  OrderByItem,
  OrExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { bindWhereExpr } from '../src/where-binding';
import { getTestContract } from './helpers';

const subqueryWithLiteral = () =>
  SelectAst.from(TableSource.named('posts'))
    .withProjection([ProjectionItem.of('id', ColumnRef.of('posts', 'id'))])
    .withWhere(BinaryExpr.eq(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)));

describe('bindWhereExpr', () => {
  const contract = getTestContract();

  it('binds a simple binary eq with a literal to a parameterized expression', () => {
    const expr = BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of('alice@test.com'));
    const bound = bindWhereExpr(contract, expr);

    expect(bound.kind).toBe('binary');
    const binary = bound as BinaryExpr;
    expect(binary.right.kind).toBe('param-ref');
    const ref = binary.right as ParamRef;
    expect(ref.value).toBe('alice@test.com');
    expect(ref.codecId).toBe('pg/text@1');
  });

  it('binds AND expressions recursively', () => {
    const expr = AndExpr.of([
      BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of('a@test.com')),
      BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
    ]);
    const bound = bindWhereExpr(contract, expr);

    const and = bound as AndExpr;
    const andRight0 = (and.exprs[0] as BinaryExpr).right;
    const andRight1 = (and.exprs[1] as BinaryExpr).right;
    expect(andRight0.kind).toBe('param-ref');
    expect(andRight1.kind).toBe('param-ref');
    expect([(andRight0 as ParamRef).value, (andRight1 as ParamRef).value]).toEqual([
      'a@test.com',
      'Alice',
    ]);
    expect((andRight0 as ParamRef).codecId).toBe('pg/text@1');
    expect((andRight1 as ParamRef).codecId).toBe('pg/text@1');
  });

  it('binds OR expressions recursively', () => {
    const expr = OrExpr.of([
      BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of('a@test.com')),
      BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of('b@test.com')),
    ]);
    const bound = bindWhereExpr(contract, expr);

    expect(bound.kind).toBe('or');
    const or = bound as OrExpr;
    const orRight0 = (or.exprs[0] as BinaryExpr).right;
    const orRight1 = (or.exprs[1] as BinaryExpr).right;
    expect(orRight0.kind).toBe('param-ref');
    expect(orRight1.kind).toBe('param-ref');
    expect([(orRight0 as ParamRef).value, (orRight1 as ParamRef).value]).toEqual([
      'a@test.com',
      'b@test.com',
    ]);
  });

  it('binds EXISTS subquery expressions and rebinds inner literals', () => {
    const subquery = SelectAst.from(TableSource.named('posts'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('posts', 'id'))])
      .withWhere(
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
          BinaryExpr.gte(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)),
        ]),
      );
    const expr = ExistsExpr.exists(subquery);
    const bound = bindWhereExpr(contract, expr);

    expect(bound.kind).toBe('exists');
    expect((bound as ExistsExpr).notExists).toBe(false);
    const innerWhere = ((bound as ExistsExpr).subquery as SelectAst).where as AndExpr;
    const viewsRight = (innerWhere.exprs[1] as BinaryExpr).right;
    expect(viewsRight.kind).toBe('param-ref');
    expect((viewsRight as ParamRef).value).toBe(100);
    expect((viewsRight as ParamRef).codecId).toBe('pg/int4@1');
  });

  it('binds NOT EXISTS subquery expressions', () => {
    const subquery = SelectAst.from(TableSource.named('posts')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('posts', 'id')),
    ]);
    const expr = ExistsExpr.notExists(subquery);
    const bound = bindWhereExpr(contract, expr);

    expect(bound.kind).toBe('exists');
    expect((bound as ExistsExpr).notExists).toBe(true);
  });

  it('binds IS NULL null-check expressions', () => {
    const expr = NullCheckExpr.isNull(ColumnRef.of('users', 'email'));
    const bound = bindWhereExpr(contract, expr);

    expect(bound.kind).toBe('null-check');
    expect((bound as NullCheckExpr).isNull).toBe(true);
  });

  it('binds IS NOT NULL null-check expressions', () => {
    const expr = NullCheckExpr.isNotNull(ColumnRef.of('users', 'email'));
    const bound = bindWhereExpr(contract, expr);

    expect(bound.kind).toBe('null-check');
    expect((bound as NullCheckExpr).isNull).toBe(false);
  });

  it('binds IN with list literal values to parameterized refs', () => {
    const expr = BinaryExpr.in(
      ColumnRef.of('users', 'id'),
      ListExpression.of([LiteralExpr.of(1), LiteralExpr.of(2)]),
    );
    const bound = bindWhereExpr(contract, expr);

    const binary = bound as BinaryExpr;
    expect(binary.right.kind).toBe('list');
    const list = binary.right as ListExpression;
    expect(list.values).toMatchObject([{ kind: 'param-ref' }, { kind: 'param-ref' }]);
    expect(list.values).toMatchObject([
      { value: 1, codecId: 'pg/int4@1' },
      { value: 2, codecId: 'pg/int4@1' },
    ]);
  });

  it('preserves ParamRef on the right side without rebinding', () => {
    const existing = ParamRef.of(42, { name: 'id', codecId: 'pg/int4@1' });
    const expr = BinaryExpr.eq(ColumnRef.of('users', 'id'), existing);
    const bound = bindWhereExpr(contract, expr);

    const binary = bound as BinaryExpr;
    expect(binary.right).toBe(existing);
  });

  it('binds subquery within a select that has joins, orderBy, and derived sources', () => {
    const inner = SelectAst.from(TableSource.named('posts'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('posts', 'id'))])
      .withOrderBy([OrderByItem.asc(ColumnRef.of('posts', 'id'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')));

    const lateral = SelectAst.from(DerivedTableSource.as('p', inner)).withProjection([
      ProjectionItem.of('id', ColumnRef.of('p', 'id')),
    ]);

    const main = SelectAst.from(TableSource.named('users'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('users', 'id'))])
      .withJoins([
        JoinAst.left(
          DerivedTableSource.as('lat', lateral),
          EqColJoinOn.of(ColumnRef.of('users', 'id'), ColumnRef.of('lat', 'id')),
          true,
        ),
      ]);

    const expr = ExistsExpr.exists(main);
    const bound = bindWhereExpr(contract, expr);

    expect(bound.kind).toBe('exists');
  });

  it('handles binary expression with non-column left side and literal right', () => {
    const subquery = SelectAst.from(TableSource.named('users')).withProjection([
      ProjectionItem.of('cnt', AggregateExpr.count()),
    ]);
    const expr = BinaryExpr.gt(SubqueryExpr.of(subquery), LiteralExpr.of(0));
    const bound = bindWhereExpr(contract, expr);

    const binary = bound as BinaryExpr;
    expect(binary.right.kind).toBe('literal');
  });

  it('handles binary expression with non-column left side and column right', () => {
    const subquery = SelectAst.from(TableSource.named('users')).withProjection([
      ProjectionItem.of('cnt', AggregateExpr.count()),
    ]);
    const expr = BinaryExpr.gt(SubqueryExpr.of(subquery), ColumnRef.of('users', 'id'));
    const bound = bindWhereExpr(contract, expr);

    const binary = bound as BinaryExpr;
    expect(binary.right.kind).toBe('column-ref');
  });

  it('binds EXISTS with a select that has HAVING, literal projections, and where-expr joins', () => {
    const subquery = SelectAst.from(TableSource.named('users'))
      .withProjection([
        ProjectionItem.of('email', ColumnRef.of('users', 'email')),
        ProjectionItem.of('one', LiteralExpr.of(1)),
      ])
      .withGroupBy([ColumnRef.of('users', 'email')])
      .withHaving(BinaryExpr.gt(AggregateExpr.count(), LiteralExpr.of(1)))
      .withJoins([
        JoinAst.inner(
          TableSource.named('posts'),
          BinaryExpr.eq(ColumnRef.of('users', 'id'), ColumnRef.of('posts', 'user_id')),
        ),
      ]);

    const expr = ExistsExpr.exists(subquery);
    const bound = bindWhereExpr(contract, expr);

    expect(bound.kind).toBe('exists');
  });

  it('passes through ParamRef values inside ListExpression without rebinding', () => {
    const existing = ParamRef.of(99, { name: 'id', codecId: 'pg/int4@1' });
    const expr = BinaryExpr.in(
      ColumnRef.of('users', 'id'),
      ListExpression.of([existing, LiteralExpr.of(42)]),
    );
    const bound = bindWhereExpr(contract, expr);

    const binary = bound as BinaryExpr;
    const list = binary.right as ListExpression;
    expect(list.values).toMatchObject([{ kind: 'param-ref' }, { kind: 'param-ref' }]);
    expect(list.values[0]).toBe(existing);
    expect(list.values).toMatchObject([{ value: 99 }, { value: 42 }]);
  });

  describe('leaf passthrough', () => {
    it('passes through IdentifierRef unchanged', () => {
      const expr = IdentifierRef.of('some_name');
      const bound = bindWhereExpr(contract, expr);

      expect(bound).toBe(expr);
    });

    it('passes through top-level LiteralExpr unchanged', () => {
      const expr = LiteralExpr.of(42);
      const bound = bindWhereExpr(contract, expr);

      expect(bound).toBe(expr);
    });

    it('passes through top-level ParamRef unchanged', () => {
      const expr = ParamRef.of('hello', { name: 'x', codecId: 'pg/text@1' });
      const bound = bindWhereExpr(contract, expr);

      expect(bound).toBe(expr);
    });
  });

  describe('composite expression binding', () => {
    it('binds inner SelectAst of SubqueryExpr', () => {
      const expr = SubqueryExpr.of(subqueryWithLiteral());
      const bound = bindWhereExpr(contract, expr);

      expect(bound.kind).toBe('subquery');
      const innerWhere = ((bound as SubqueryExpr).query as SelectAst).where as BinaryExpr;
      expect(innerWhere.right.kind).toBe('param-ref');
      expect((innerWhere.right as ParamRef).value).toBe(100);
      expect((innerWhere.right as ParamRef).codecId).toBe('pg/int4@1');
    });

    it('binds inner expressions of OperationExpr', () => {
      const expr = OperationExpr.function({
        method: 'contains',
        forTypeId: 'pg/text@1',
        self: SubqueryExpr.of(subqueryWithLiteral()),
        args: [],
        returns: { kind: 'builtin', type: 'boolean' },
        template: 'position({1} in {0}) > 0',
      });
      const bound = bindWhereExpr(contract, expr);

      expect(bound.kind).toBe('operation');
      const op = bound as OperationExpr;
      const innerQuery = (op.self as SubqueryExpr).query as SelectAst;
      const innerWhere = innerQuery.where as BinaryExpr;
      expect(innerWhere.right.kind).toBe('param-ref');
      expect((innerWhere.right as ParamRef).codecId).toBe('pg/int4@1');
    });

    it('binds inner expression of AggregateExpr', () => {
      const expr = AggregateExpr.sum(SubqueryExpr.of(subqueryWithLiteral()));
      const bound = bindWhereExpr(contract, expr);

      expect(bound.kind).toBe('aggregate');
      const agg = bound as AggregateExpr;
      const innerQuery = (agg.expr as SubqueryExpr).query as SelectAst;
      const innerWhere = innerQuery.where as BinaryExpr;
      expect(innerWhere.right.kind).toBe('param-ref');
    });

    it('binds inner expressions of JsonObjectExpr', () => {
      const expr = JsonObjectExpr.fromEntries([
        JsonObjectExpr.entry('sub', SubqueryExpr.of(subqueryWithLiteral())),
      ]);
      const bound = bindWhereExpr(contract, expr);

      expect(bound.kind).toBe('json-object');
      const json = bound as JsonObjectExpr;
      const innerQuery = (json.entries[0]!.value as SubqueryExpr).query as SelectAst;
      const innerWhere = innerQuery.where as BinaryExpr;
      expect(innerWhere.right.kind).toBe('param-ref');
    });

    it('binds inner expression of JsonArrayAggExpr', () => {
      const expr = JsonArrayAggExpr.of(SubqueryExpr.of(subqueryWithLiteral()));
      const bound = bindWhereExpr(contract, expr);

      expect(bound.kind).toBe('json-array-agg');
      const agg = bound as JsonArrayAggExpr;
      const innerQuery = (agg.expr as SubqueryExpr).query as SelectAst;
      const innerWhere = innerQuery.where as BinaryExpr;
      expect(innerWhere.right.kind).toBe('param-ref');
    });

    it('binds inner expressions of top-level ListExpression', () => {
      const expr = ListExpression.of([SubqueryExpr.of(subqueryWithLiteral())]);
      const bound = bindWhereExpr(contract, expr);

      expect(bound.kind).toBe('list');
      const list = bound as ListExpression;
      const innerQuery = (list.values[0] as SubqueryExpr).query as SelectAst;
      const innerWhere = innerQuery.where as BinaryExpr;
      expect(innerWhere.right.kind).toBe('param-ref');
    });
  });

  describe('NotExpr', () => {
    it('binds inner binary expression', () => {
      const expr = new NotExpr(
        BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of('test@test.com')),
      );
      const bound = bindWhereExpr(contract, expr);

      expect(bound.kind).toBe('not');
      const inner = (bound as NotExpr).expr as BinaryExpr;
      expect(inner.right.kind).toBe('param-ref');
      expect((inner.right as ParamRef).value).toBe('test@test.com');
      expect((inner.right as ParamRef).codecId).toBe('pg/text@1');
    });

    it('binds NOT(AND(...)) recursively', () => {
      const expr = new NotExpr(
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of('a@test.com')),
          BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
        ]),
      );
      const bound = bindWhereExpr(contract, expr);

      const and = (bound as NotExpr).expr as AndExpr;
      expect((and.exprs[0] as BinaryExpr).right.kind).toBe('param-ref');
      expect((and.exprs[1] as BinaryExpr).right.kind).toBe('param-ref');
    });
  });

  describe('error handling', () => {
    it('throws for unknown table', () => {
      const expr = BinaryExpr.eq(ColumnRef.of('nonexistent', 'col'), LiteralExpr.of('x'));
      expect(() => bindWhereExpr(contract, expr)).toThrow(
        'Unknown column "col" in table "nonexistent"',
      );
    });

    it('throws for unknown column', () => {
      const expr = BinaryExpr.eq(ColumnRef.of('users', 'nonexistent'), LiteralExpr.of('x'));
      expect(() => bindWhereExpr(contract, expr)).toThrow(
        'Unknown column "nonexistent" in table "users"',
      );
    });
  });

  describe('bindComparable edge cases', () => {
    it('preserves column-ref on right when left is a column', () => {
      const expr = BinaryExpr.eq(ColumnRef.of('users', 'id'), ColumnRef.of('posts', 'user_id'));
      const bound = bindWhereExpr(contract, expr);

      const binary = bound as BinaryExpr;
      expect(binary.right.kind).toBe('column-ref');
    });

    it('rewrites aggregate on right via bindExpression when left is a column', () => {
      const aggWithSubquery = AggregateExpr.sum(SubqueryExpr.of(subqueryWithLiteral()));
      const expr = BinaryExpr.eq(ColumnRef.of('users', 'id'), aggWithSubquery);
      const bound = bindWhereExpr(contract, expr);

      const binary = bound as BinaryExpr;
      expect(binary.right.kind).toBe('aggregate');
      const innerQuery = ((binary.right as AggregateExpr).expr as SubqueryExpr).query as SelectAst;
      const innerWhere = innerQuery.where as BinaryExpr;
      expect(innerWhere.right.kind).toBe('param-ref');
    });

    it('rewrites non-literal/non-param right via bindExpression when left is not a column', () => {
      const aggWithSubquery = AggregateExpr.sum(SubqueryExpr.of(subqueryWithLiteral()));
      const expr = BinaryExpr.gt(AggregateExpr.count(), aggWithSubquery);
      const bound = bindWhereExpr(contract, expr);

      const binary = bound as BinaryExpr;
      expect(binary.right.kind).toBe('aggregate');
      const innerQuery = ((binary.right as AggregateExpr).expr as SubqueryExpr).query as SelectAst;
      const innerWhere = innerQuery.where as BinaryExpr;
      expect(innerWhere.right.kind).toBe('param-ref');
    });
  });

  describe('binary operators', () => {
    it('neq binds literal to param', () => {
      const expr = BinaryExpr.neq(ColumnRef.of('users', 'name'), LiteralExpr.of('Bob'));
      const bound = bindWhereExpr(contract, expr) as BinaryExpr;

      expect(bound.op).toBe('neq');
      expect(bound.right.kind).toBe('param-ref');
      expect((bound.right as ParamRef).value).toBe('Bob');
    });

    it('lt binds literal to param', () => {
      const expr = BinaryExpr.lt(ColumnRef.of('posts', 'views'), LiteralExpr.of(50));
      const bound = bindWhereExpr(contract, expr) as BinaryExpr;

      expect(bound.op).toBe('lt');
      expect(bound.right.kind).toBe('param-ref');
      expect((bound.right as ParamRef).codecId).toBe('pg/int4@1');
    });

    it('lte binds literal to param', () => {
      const expr = BinaryExpr.lte(ColumnRef.of('posts', 'views'), LiteralExpr.of(50));
      const bound = bindWhereExpr(contract, expr) as BinaryExpr;

      expect(bound.op).toBe('lte');
      expect(bound.right.kind).toBe('param-ref');
    });

    it('like binds literal to param', () => {
      const expr = BinaryExpr.like(ColumnRef.of('users', 'name'), LiteralExpr.of('%alice%'));
      const bound = bindWhereExpr(contract, expr) as BinaryExpr;

      expect(bound.op).toBe('like');
      expect(bound.right.kind).toBe('param-ref');
      expect((bound.right as ParamRef).value).toBe('%alice%');
    });

    it('ilike binds literal to param', () => {
      const expr = BinaryExpr.ilike(ColumnRef.of('users', 'name'), LiteralExpr.of('%alice%'));
      const bound = bindWhereExpr(contract, expr) as BinaryExpr;

      expect(bound.op).toBe('ilike');
      expect(bound.right.kind).toBe('param-ref');
    });

    it('notIn binds list literals to params', () => {
      const expr = BinaryExpr.notIn(
        ColumnRef.of('users', 'id'),
        ListExpression.of([LiteralExpr.of(1), LiteralExpr.of(2)]),
      );
      const bound = bindWhereExpr(contract, expr) as BinaryExpr;

      expect(bound.op).toBe('notIn');
      const list = bound.right as ListExpression;
      expect(list.values).toMatchObject([
        { kind: 'param-ref', value: 1, codecId: 'pg/int4@1' },
        { kind: 'param-ref', value: 2, codecId: 'pg/int4@1' },
      ]);
    });
  });

  describe('SelectAst binding details', () => {
    it('preserves and binds distinctOn expressions', () => {
      const subquery = SelectAst.from(TableSource.named('posts'))
        .withProjection([ProjectionItem.of('title', ColumnRef.of('posts', 'title'))])
        .withDistinctOn([ColumnRef.of('posts', 'user_id')])
        .withWhere(BinaryExpr.eq(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)));
      const expr = ExistsExpr.exists(subquery);
      const bound = bindWhereExpr(contract, expr);

      const select = (bound as ExistsExpr).subquery as SelectAst;
      expect(select.distinctOn).toHaveLength(1);
      expect(select.distinctOn?.[0]?.kind).toBe('column-ref');
      const innerWhere = select.where as BinaryExpr;
      expect(innerWhere.right.kind).toBe('param-ref');
    });

    it('preserves limit and offset', () => {
      const subquery = SelectAst.from(TableSource.named('posts'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('posts', 'id'))])
        .withLimit(10)
        .withOffset(5)
        .withWhere(BinaryExpr.eq(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)));
      const expr = ExistsExpr.exists(subquery);
      const bound = bindWhereExpr(contract, expr);

      const select = (bound as ExistsExpr).subquery as SelectAst;
      expect(select.limit).toBe(10);
      expect(select.offset).toBe(5);
    });
  });

  describe('nested logical expressions', () => {
    it('binds AND inside OR', () => {
      const expr = OrExpr.of([
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
          BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of('a@test.com')),
        ]),
        BinaryExpr.eq(ColumnRef.of('users', 'id'), LiteralExpr.of(1)),
      ]);
      const bound = bindWhereExpr(contract, expr);

      const or = bound as OrExpr;
      const and = or.exprs[0] as AndExpr;
      expect((and.exprs[0] as BinaryExpr).right.kind).toBe('param-ref');
      expect((and.exprs[1] as BinaryExpr).right.kind).toBe('param-ref');
      expect((or.exprs[1] as BinaryExpr).right.kind).toBe('param-ref');
    });

    it('binds NOT inside AND', () => {
      const expr = AndExpr.of([
        new NotExpr(BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Bob'))),
        BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of('a@test.com')),
      ]);
      const bound = bindWhereExpr(contract, expr);

      const and = bound as AndExpr;
      const not = and.exprs[0] as NotExpr;
      expect((not.expr as BinaryExpr).right.kind).toBe('param-ref');
      expect((and.exprs[1] as BinaryExpr).right.kind).toBe('param-ref');
    });
  });
});
