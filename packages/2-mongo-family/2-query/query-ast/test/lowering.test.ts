import { MongoParamRef } from '@prisma-next/mongo-core';
import { describe, expect, it } from 'vitest';
import {
  MongoAndExpr,
  MongoExistsExpr,
  MongoFieldFilter,
  MongoNotExpr,
  MongoOrExpr,
} from '../src/filter-expressions';
import { lowerFilter, lowerPipeline, lowerStage } from '../src/lowering';
import {
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  MongoProjectStage,
  MongoSkipStage,
  MongoSortStage,
  MongoUnwindStage,
} from '../src/stages';

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
    const lowered = lowerStage(stage) as Record<string, Record<string, unknown>>;
    expect(lowered.$lookup.pipeline).toEqual([{ $match: { published: { $eq: true } } }]);
  });

  it('lowers $unwind stage', () => {
    const stage = new MongoUnwindStage('$posts', true);
    expect(lowerStage(stage)).toEqual({
      $unwind: { path: '$posts', preserveNullAndEmptyArrays: true },
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
