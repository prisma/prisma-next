import {
  MongoAggAccumulator,
  MongoAggArrayFilter,
  MongoAggCond,
  MongoAggFieldRef,
  MongoAggLet,
  MongoAggLiteral,
  MongoAggMap,
  MongoAggMergeObjects,
  MongoAggOperator,
  MongoAggReduce,
  MongoAggSwitch,
  MongoAndExpr,
  MongoExistsExpr,
  MongoExprFilter,
  MongoFieldFilter,
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  MongoNotExpr,
  MongoOrExpr,
  MongoProjectStage,
  MongoSkipStage,
  MongoSortStage,
  MongoUnwindStage,
} from '@prisma-next/mongo-query-ast';
import { MongoParamRef } from '@prisma-next/mongo-value';
import { describe, expect, it } from 'vitest';
import { lowerAggExpr, lowerFilter, lowerPipeline, lowerStage } from '../src/lowering';

describe('lowerFilter', () => {
  it('lowers MongoFieldFilter with $eq', () => {
    const filter = MongoFieldFilter.eq('email', 'alice@example.com');
    expect(lowerFilter(filter)).toEqual({ email: { $eq: 'alice@example.com' } });
  });

  it('lowers MongoFieldFilter with $gt', () => {
    expect(lowerFilter(MongoFieldFilter.gt('age', 18))).toEqual({ age: { $gt: 18 } });
  });

  it('lowers MongoFieldFilter with arbitrary operator', () => {
    expect(lowerFilter(MongoFieldFilter.of('loc', '$near', [1, 2]))).toEqual({
      loc: { $near: [1, 2] },
    });
  });

  it('lowers MongoAndExpr', () => {
    const and = MongoAndExpr.of([MongoFieldFilter.eq('x', 1), MongoFieldFilter.gt('y', 2)]);
    expect(lowerFilter(and)).toEqual({
      $and: [{ x: { $eq: 1 } }, { y: { $gt: 2 } }],
    });
  });

  it('lowers MongoOrExpr', () => {
    const or = MongoOrExpr.of([
      MongoFieldFilter.eq('status', 'active'),
      MongoFieldFilter.eq('status', 'pending'),
    ]);
    expect(lowerFilter(or)).toEqual({
      $or: [{ status: { $eq: 'active' } }, { status: { $eq: 'pending' } }],
    });
  });

  it('lowers MongoNotExpr to $nor', () => {
    const not = new MongoNotExpr(MongoFieldFilter.eq('x', 1));
    expect(lowerFilter(not)).toEqual({ $nor: [{ x: { $eq: 1 } }] });
  });

  it('lowers MongoExistsExpr (true)', () => {
    expect(lowerFilter(MongoExistsExpr.exists('name'))).toEqual({ name: { $exists: true } });
  });

  it('lowers MongoExistsExpr (false)', () => {
    expect(lowerFilter(MongoExistsExpr.notExists('name'))).toEqual({ name: { $exists: false } });
  });

  it('lowers nested composite filters', () => {
    const filter = MongoAndExpr.of([
      MongoOrExpr.of([MongoFieldFilter.eq('x', 1), MongoFieldFilter.eq('x', 2)]),
      new MongoNotExpr(MongoFieldFilter.gt('y', 10)),
    ]);
    expect(lowerFilter(filter)).toEqual({
      $and: [{ $or: [{ x: { $eq: 1 } }, { x: { $eq: 2 } }] }, { $nor: [{ y: { $gt: 10 } }] }],
    });
  });

  it('resolves MongoParamRef values during lowering', () => {
    const param = MongoParamRef.of('alice@example.com', { name: 'email' });
    const filter = MongoFieldFilter.eq('email', param);
    expect(lowerFilter(filter)).toEqual({ email: { $eq: 'alice@example.com' } });
  });

  it('lowers MongoFieldFilter.isNull', () => {
    expect(lowerFilter(MongoFieldFilter.isNull('bio'))).toEqual({ bio: { $eq: null } });
  });

  it('lowers MongoFieldFilter.isNotNull', () => {
    expect(lowerFilter(MongoFieldFilter.isNotNull('bio'))).toEqual({ bio: { $ne: null } });
  });

  it('resolves nested MongoParamRef in document values', () => {
    const param = MongoParamRef.of(42);
    const filter = MongoFieldFilter.of('data', '$elemMatch', { value: param });
    expect(lowerFilter(filter)).toEqual({ data: { $elemMatch: { value: 42 } } });
  });

  it('lowers MongoExprFilter to $expr with aggregation expression', () => {
    const filter = MongoExprFilter.of(
      MongoAggOperator.of('$gt', [MongoAggFieldRef.of('qty'), MongoAggFieldRef.of('minQty')]),
    );
    expect(lowerFilter(filter)).toEqual({
      $expr: { $gt: ['$qty', '$minQty'] },
    });
  });

  it('lowers MongoExprFilter with nested arithmetic', () => {
    const filter = MongoExprFilter.of(
      MongoAggOperator.of('$gt', [
        MongoAggFieldRef.of('price'),
        MongoAggOperator.multiply(MongoAggFieldRef.of('discount'), MongoAggLiteral.of(2)),
      ]),
    );
    expect(lowerFilter(filter)).toEqual({
      $expr: { $gt: ['$price', { $multiply: ['$discount', 2] }] },
    });
  });
});

describe('lowerStage', () => {
  it('lowers $match stage', () => {
    const stage = new MongoMatchStage(MongoFieldFilter.eq('x', 1));
    expect(lowerStage(stage)).toEqual({ $match: { x: { $eq: 1 } } });
  });

  it('lowers $project stage', () => {
    const stage = new MongoProjectStage({ name: 1, email: 1, _id: 0 });
    expect(lowerStage(stage)).toEqual({ $project: { name: 1, email: 1, _id: 0 } });
  });

  it('lowers $sort stage', () => {
    const stage = new MongoSortStage({ age: -1, name: 1 });
    expect(lowerStage(stage)).toEqual({ $sort: { age: -1, name: 1 } });
  });

  it('lowers $limit stage', () => {
    expect(lowerStage(new MongoLimitStage(10))).toEqual({ $limit: 10 });
  });

  it('lowers $skip stage', () => {
    expect(lowerStage(new MongoSkipStage(5))).toEqual({ $skip: 5 });
  });

  it('lowers $lookup stage without pipeline', () => {
    const stage = new MongoLookupStage({
      from: 'posts',
      localField: '_id',
      foreignField: 'authorId',
      as: 'userPosts',
    });
    expect(lowerStage(stage)).toEqual({
      $lookup: {
        from: 'posts',
        localField: '_id',
        foreignField: 'authorId',
        as: 'userPosts',
      },
    });
  });

  it('lowers $lookup stage with nested pipeline', () => {
    const stage = new MongoLookupStage({
      from: 'posts',
      localField: '_id',
      foreignField: 'authorId',
      as: 'userPosts',
      pipeline: [new MongoMatchStage(MongoFieldFilter.eq('published', true))],
    });
    expect(lowerStage(stage)).toEqual({
      $lookup: {
        from: 'posts',
        localField: '_id',
        foreignField: 'authorId',
        as: 'userPosts',
        pipeline: [{ $match: { published: { $eq: true } } }],
      },
    });
  });

  it('lowers $unwind stage', () => {
    const stage = new MongoUnwindStage('$posts', true);
    expect(lowerStage(stage)).toEqual({
      $unwind: { path: '$posts', preserveNullAndEmptyArrays: true },
    });
  });
});

describe('lowerAggExpr', () => {
  it('lowers MongoAggFieldRef to $-prefixed string', () => {
    expect(lowerAggExpr(MongoAggFieldRef.of('name'))).toBe('$name');
  });

  it('lowers dotted field ref', () => {
    expect(lowerAggExpr(MongoAggFieldRef.of('address.city'))).toBe('$address.city');
  });

  it('lowers unambiguous literal directly', () => {
    expect(lowerAggExpr(MongoAggLiteral.of(42))).toBe(42);
  });

  it('lowers string literal directly when unambiguous', () => {
    expect(lowerAggExpr(MongoAggLiteral.of('hello'))).toBe('hello');
  });

  it('lowers null literal directly', () => {
    expect(lowerAggExpr(MongoAggLiteral.of(null))).toBe(null);
  });

  it('lowers boolean literal directly', () => {
    expect(lowerAggExpr(MongoAggLiteral.of(true))).toBe(true);
  });

  it('wraps $-prefixed string literal in $literal', () => {
    expect(lowerAggExpr(MongoAggLiteral.of('$ambiguous'))).toEqual({
      $literal: '$ambiguous',
    });
  });

  it('wraps object with $-prefixed keys in $literal', () => {
    expect(lowerAggExpr(MongoAggLiteral.of({ $foo: 1 }))).toEqual({
      $literal: { $foo: 1 },
    });
  });

  it('does not wrap plain object literal', () => {
    expect(lowerAggExpr(MongoAggLiteral.of({ key: 'value' }))).toEqual({ key: 'value' });
  });

  it('lowers array-arg operator', () => {
    expect(
      lowerAggExpr(MongoAggOperator.add(MongoAggFieldRef.of('price'), MongoAggFieldRef.of('tax'))),
    ).toEqual({ $add: ['$price', '$tax'] });
  });

  it('lowers single-arg operator', () => {
    expect(lowerAggExpr(MongoAggOperator.toLower(MongoAggFieldRef.of('name')))).toEqual({
      $toLower: '$name',
    });
  });

  it('lowers nested operator expression', () => {
    const expr = MongoAggOperator.multiply(
      MongoAggFieldRef.of('price'),
      MongoAggOperator.subtract(MongoAggLiteral.of(1), MongoAggFieldRef.of('discount')),
    );
    expect(lowerAggExpr(expr)).toEqual({
      $multiply: ['$price', { $subtract: [1, '$discount'] }],
    });
  });

  it('lowers accumulator with arg', () => {
    expect(lowerAggExpr(MongoAggAccumulator.sum(MongoAggFieldRef.of('amount')))).toEqual({
      $sum: '$amount',
    });
  });

  it('lowers $count accumulator with null arg to empty object', () => {
    expect(lowerAggExpr(MongoAggAccumulator.count())).toEqual({ $count: {} });
  });

  it('lowers $cond', () => {
    const expr = MongoAggCond.of(
      MongoAggOperator.of('$gte', [MongoAggFieldRef.of('age'), MongoAggLiteral.of(18)]),
      MongoAggLiteral.of('adult'),
      MongoAggLiteral.of('minor'),
    );
    const thenKey = 'then';
    expect(lowerAggExpr(expr)).toEqual({
      $cond: Object.fromEntries([
        ['if', { $gte: ['$age', 18] }],
        [thenKey, 'adult'],
        ['else', 'minor'],
      ]),
    });
  });

  it('lowers $switch', () => {
    const expr = MongoAggSwitch.of(
      [
        {
          case_: MongoAggOperator.of('$eq', [
            MongoAggFieldRef.of('status'),
            MongoAggLiteral.of('active'),
          ]),
          then_: MongoAggLiteral.of('Active'),
        },
      ],
      MongoAggLiteral.of('Unknown'),
    );
    const thenKey = 'then';
    expect(lowerAggExpr(expr)).toEqual({
      $switch: {
        branches: [
          Object.fromEntries([
            ['case', { $eq: ['$status', 'active'] }],
            [thenKey, 'Active'],
          ]),
        ],
        default: 'Unknown',
      },
    });
  });

  it('lowers $filter', () => {
    const expr = MongoAggArrayFilter.of(
      MongoAggFieldRef.of('scores'),
      MongoAggOperator.of('$gte', [MongoAggFieldRef.of('score'), MongoAggLiteral.of(70)]),
      'score',
    );
    expect(lowerAggExpr(expr)).toEqual({
      $filter: {
        input: '$scores',
        cond: { $gte: ['$score', 70] },
        as: 'score',
      },
    });
  });

  it('lowers $map', () => {
    const expr = MongoAggMap.of(
      MongoAggFieldRef.of('items'),
      MongoAggOperator.multiply(MongoAggFieldRef.of('item.price'), MongoAggFieldRef.of('item.qty')),
      'item',
    );
    expect(lowerAggExpr(expr)).toEqual({
      $map: {
        input: '$items',
        in: { $multiply: ['$item.price', '$item.qty'] },
        as: 'item',
      },
    });
  });

  it('lowers $reduce', () => {
    const expr = MongoAggReduce.of(
      MongoAggFieldRef.of('items'),
      MongoAggLiteral.of(0),
      MongoAggOperator.add(MongoAggFieldRef.of('value'), MongoAggFieldRef.of('this')),
    );
    expect(lowerAggExpr(expr)).toEqual({
      $reduce: {
        input: '$items',
        initialValue: 0,
        in: { $add: ['$value', '$this'] },
      },
    });
  });

  it('lowers $let', () => {
    const expr = MongoAggLet.of(
      {
        total: MongoAggOperator.add(MongoAggFieldRef.of('price'), MongoAggFieldRef.of('tax')),
      },
      MongoAggOperator.multiply(
        MongoAggFieldRef.of('total'),
        MongoAggOperator.subtract(MongoAggLiteral.of(1), MongoAggFieldRef.of('discount')),
      ),
    );
    expect(lowerAggExpr(expr)).toEqual({
      $let: {
        vars: { total: { $add: ['$price', '$tax'] } },
        in: { $multiply: ['$total', { $subtract: [1, '$discount'] }] },
      },
    });
  });

  it('lowers $mergeObjects', () => {
    const expr = MongoAggMergeObjects.of([
      MongoAggFieldRef.of('defaults'),
      MongoAggFieldRef.of('overrides'),
    ]);
    expect(lowerAggExpr(expr)).toEqual({
      $mergeObjects: ['$defaults', '$overrides'],
    });
  });
});

describe('lowerPipeline', () => {
  it('lowers a full pipeline to MongoDB driver format', () => {
    const stages = [
      new MongoMatchStage(
        MongoAndExpr.of([MongoFieldFilter.eq('status', 'active'), MongoFieldFilter.gte('age', 18)]),
      ),
      new MongoLookupStage({
        from: 'posts',
        localField: '_id',
        foreignField: 'authorId',
        as: 'posts',
      }),
      new MongoUnwindStage('$posts', true),
      new MongoSortStage({ createdAt: -1 }),
      new MongoSkipStage(10),
      new MongoLimitStage(5),
      new MongoProjectStage({ name: 1, email: 1, posts: 1 }),
    ];

    const lowered = lowerPipeline(stages);
    expect(lowered).toEqual([
      {
        $match: {
          $and: [{ status: { $eq: 'active' } }, { age: { $gte: 18 } }],
        },
      },
      {
        $lookup: {
          from: 'posts',
          localField: '_id',
          foreignField: 'authorId',
          as: 'posts',
        },
      },
      { $unwind: { path: '$posts', preserveNullAndEmptyArrays: true } },
      { $sort: { createdAt: -1 } },
      { $skip: 10 },
      { $limit: 5 },
      { $project: { name: 1, email: 1, posts: 1 } },
    ]);
  });
});
