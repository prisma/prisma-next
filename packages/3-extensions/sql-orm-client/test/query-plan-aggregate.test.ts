import {
  AggregateExpr,
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  IdentifierRef,
  JsonArrayAggExpr,
  JsonObjectExpr,
  ListExpression,
  LiteralExpr,
  NotExpr,
  NullCheckExpr,
  OperationExpr,
  OrExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { compileAggregate, compileGroupedAggregate } from '../src/query-plan';
import { bindWhereExpr } from '../src/where-binding';
import { baseContract } from './collection-fixtures';

const defaultAggSpec = {
  totalViews: { kind: 'aggregate' as const, fn: 'sum' as const, column: 'views' },
};

function compileWithHaving(having: AnyExpression) {
  return compileGroupedAggregate(baseContract, 'posts', [], ['user_id'], defaultAggSpec, having);
}

describe('query plan aggregate', () => {
  const filteredViews = bindWhereExpr(
    baseContract,
    BinaryExpr.gte(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)),
  );

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
          ListExpression.of([ParamRef.of(1, { name: 'views', codecId: 'pg/int4@1' })]),
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
    ).toThrow('Unsupported grouped having expression kind "exists"');

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
          ListExpression.fromValues([1, 2]),
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
          ListExpression.of([LiteralExpr.of(1), LiteralExpr.of(2)]),
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
    expect(ast.where).toEqual(filteredViews);
    expect(plan.params).toEqual([100]);
    expect(plan.meta.paramDescriptors).toEqual([
      {
        name: 'views',
        source: 'dsl',
        codecId: 'pg/int4@1',
      },
    ]);
  });

  describe('validateGroupedHavingExpr rejects non-predicate expression types', () => {
    it('rejects ColumnRef', () => {
      expect(() => compileWithHaving(ColumnRef.of('posts', 'views'))).toThrow(
        'Unsupported grouped having expression kind "column-ref"',
      );
    });

    it('rejects IdentifierRef', () => {
      expect(() => compileWithHaving(IdentifierRef.of('some_name'))).toThrow(
        'Unsupported grouped having expression kind "identifier-ref"',
      );
    });

    it('rejects SubqueryExpr', () => {
      const sub = SubqueryExpr.of(
        SelectAst.from(TableSource.named('posts')).withProjection([
          ProjectionItem.of('id', ColumnRef.of('posts', 'id')),
        ]),
      );
      expect(() => compileWithHaving(sub)).toThrow(
        'Unsupported grouped having expression kind "subquery"',
      );
    });

    it('rejects OperationExpr', () => {
      const op = OperationExpr.function({
        method: 'contains',
        forTypeId: 'pg/text@1',
        self: ColumnRef.of('posts', 'title'),
        args: [LiteralExpr.of('test')],
        returns: { kind: 'builtin', type: 'boolean' },
        template: 'position({1} in {0}) > 0',
      });
      expect(() => compileWithHaving(op)).toThrow(
        'Unsupported grouped having expression kind "operation"',
      );
    });

    it('rejects bare AggregateExpr', () => {
      expect(() => compileWithHaving(AggregateExpr.count())).toThrow(
        'Unsupported grouped having expression kind "aggregate"',
      );
    });

    it('rejects JsonObjectExpr', () => {
      const json = JsonObjectExpr.fromEntries([
        JsonObjectExpr.entry('x', ColumnRef.of('posts', 'id')),
      ]);
      expect(() => compileWithHaving(json)).toThrow(
        'Unsupported grouped having expression kind "json-object"',
      );
    });

    it('rejects JsonArrayAggExpr', () => {
      const agg = JsonArrayAggExpr.of(ColumnRef.of('posts', 'id'));
      expect(() => compileWithHaving(agg)).toThrow(
        'Unsupported grouped having expression kind "json-array-agg"',
      );
    });

    it('rejects LiteralExpr', () => {
      expect(() => compileWithHaving(LiteralExpr.of(true))).toThrow(
        'Unsupported grouped having expression kind "literal"',
      );
    });

    it('rejects top-level ParamRef', () => {
      expect(() => compileWithHaving(ParamRef.of(1, { name: 'x', codecId: 'pg/int4@1' }))).toThrow(
        'ParamRef is not supported in grouped having expressions',
      );
    });

    it('rejects ListExpression', () => {
      expect(() =>
        compileWithHaving(ListExpression.of([LiteralExpr.of(1), LiteralExpr.of(2)])),
      ).toThrow('Unsupported grouped having expression kind "list"');
    });
  });

  describe('validateGroupedHavingExpr rejects invalid expressions inside logical operators', () => {
    it('rejects invalid expression inside AND', () => {
      expect(() =>
        compileWithHaving(
          AndExpr.of([
            BinaryExpr.gte(AggregateExpr.count(), LiteralExpr.of(5)),
            ColumnRef.of('posts', 'views'),
          ]),
        ),
      ).toThrow('Unsupported grouped having expression kind "column-ref"');
    });

    it('rejects invalid expression inside OR', () => {
      expect(() =>
        compileWithHaving(
          OrExpr.of([
            BinaryExpr.gte(AggregateExpr.count(), LiteralExpr.of(5)),
            LiteralExpr.of(true),
          ]),
        ),
      ).toThrow('Unsupported grouped having expression kind "literal"');
    });

    it('rejects invalid expression inside NOT', () => {
      expect(() => compileWithHaving(new NotExpr(AggregateExpr.count()))).toThrow(
        'Unsupported grouped having expression kind "aggregate"',
      );
    });
  });

  describe('validateGroupedHavingExpr accepts valid predicate expressions', () => {
    it('accepts NOT wrapping a valid binary', () => {
      const plan = compileWithHaving(
        new NotExpr(BinaryExpr.gte(AggregateExpr.count(), LiteralExpr.of(5))),
      );
      expect((plan.ast as SelectAst).having).toBeInstanceOf(NotExpr);
    });

    it('accepts NOT wrapping NullCheck', () => {
      const plan = compileWithHaving(
        new NotExpr(NullCheckExpr.isNull(AggregateExpr.sum(ColumnRef.of('posts', 'views')))),
      );
      expect((plan.ast as SelectAst).having).toBeInstanceOf(NotExpr);
    });

    it('accepts nested NOT(AND(binary, binary))', () => {
      const plan = compileWithHaving(
        new NotExpr(
          AndExpr.of([
            BinaryExpr.gte(AggregateExpr.count(), LiteralExpr.of(1)),
            BinaryExpr.lte(AggregateExpr.sum(ColumnRef.of('posts', 'views')), LiteralExpr.of(100)),
          ]),
        ),
      );
      expect((plan.ast as SelectAst).having).toBeInstanceOf(NotExpr);
    });
  });

  describe('validateGroupedComparable rejects invalid right-side expressions', () => {
    it('rejects SubqueryExpr on right side of binary', () => {
      const sub = SubqueryExpr.of(
        SelectAst.from(TableSource.named('posts')).withProjection([
          ProjectionItem.of('id', ColumnRef.of('posts', 'id')),
        ]),
      );
      expect(() => compileWithHaving(BinaryExpr.gte(AggregateExpr.count(), sub))).toThrow(
        'Unsupported comparable kind in grouped having: "subquery"',
      );
    });

    it('rejects JsonObjectExpr on right side of binary', () => {
      const json = JsonObjectExpr.fromEntries([JsonObjectExpr.entry('x', LiteralExpr.of(1))]);
      expect(() => compileWithHaving(BinaryExpr.gte(AggregateExpr.count(), json))).toThrow(
        'Unsupported comparable kind in grouped having: "json-object"',
      );
    });
  });
});
