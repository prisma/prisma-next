import { lowerPipeline, MongoFieldFilter } from '@prisma-next/mongo-query-ast';
import { describe, expect, it } from 'vitest';
import type { MongoCollectionState } from '../src/collection-state';
import { emptyCollectionState } from '../src/collection-state';
import { compileMongoQuery } from '../src/compile';

describe('compileMongoQuery', () => {
  it('produces empty pipeline from empty state', () => {
    const plan = compileMongoQuery('users', emptyCollectionState());
    expect(plan.collection).toBe('users');
    expect(plan.stages).toEqual([]);
    expect(plan.meta.lane).toBe('mongo-orm');
  });

  it('compiles a single filter to $match', () => {
    const state: MongoCollectionState = {
      ...emptyCollectionState(),
      filters: [MongoFieldFilter.eq('name', 'Alice')],
    };
    const plan = compileMongoQuery('users', state);
    const lowered = lowerPipeline(plan.stages);
    expect(lowered).toEqual([{ $match: { name: { $eq: 'Alice' } } }]);
  });

  it('combines multiple filters with $and', () => {
    const state: MongoCollectionState = {
      ...emptyCollectionState(),
      filters: [MongoFieldFilter.eq('name', 'Alice'), MongoFieldFilter.gte('age', 18)],
    };
    const plan = compileMongoQuery('users', state);
    const lowered = lowerPipeline(plan.stages);
    expect(lowered).toEqual([
      {
        $match: {
          $and: [{ name: { $eq: 'Alice' } }, { age: { $gte: 18 } }],
        },
      },
    ]);
  });

  it('compiles selectedFields to $project', () => {
    const state: MongoCollectionState = {
      ...emptyCollectionState(),
      selectedFields: ['name', 'email'],
    };
    const plan = compileMongoQuery('users', state);
    const lowered = lowerPipeline(plan.stages);
    expect(lowered).toEqual([{ $project: { name: 1, email: 1 } }]);
  });

  it('compiles orderBy to $sort', () => {
    const state: MongoCollectionState = {
      ...emptyCollectionState(),
      orderBy: { age: -1, name: 1 },
    };
    const plan = compileMongoQuery('users', state);
    const lowered = lowerPipeline(plan.stages);
    expect(lowered).toEqual([{ $sort: { age: -1, name: 1 } }]);
  });

  it('compiles limit to $limit', () => {
    const state: MongoCollectionState = {
      ...emptyCollectionState(),
      limit: 10,
    };
    const plan = compileMongoQuery('users', state);
    const lowered = lowerPipeline(plan.stages);
    expect(lowered).toEqual([{ $limit: 10 }]);
  });

  it('compiles offset to $skip', () => {
    const state: MongoCollectionState = {
      ...emptyCollectionState(),
      offset: 5,
    };
    const plan = compileMongoQuery('users', state);
    const lowered = lowerPipeline(plan.stages);
    expect(lowered).toEqual([{ $skip: 5 }]);
  });

  it('compiles includes to $lookup + $unwind for to-one', () => {
    const state: MongoCollectionState = {
      ...emptyCollectionState(),
      includes: [
        {
          relationName: 'author',
          from: 'users',
          localField: 'authorId',
          foreignField: '_id',
          cardinality: 'N:1',
        },
      ],
    };
    const plan = compileMongoQuery('posts', state);
    const lowered = lowerPipeline(plan.stages);
    expect(lowered).toEqual([
      {
        $lookup: {
          from: 'users',
          localField: 'authorId',
          foreignField: '_id',
          as: 'author',
        },
      },
      { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } },
    ]);
  });

  it('compiles includes to $lookup without $unwind for to-many', () => {
    const state: MongoCollectionState = {
      ...emptyCollectionState(),
      includes: [
        {
          relationName: 'posts',
          from: 'posts',
          localField: '_id',
          foreignField: 'authorId',
          cardinality: '1:N',
        },
      ],
    };
    const plan = compileMongoQuery('users', state);
    const lowered = lowerPipeline(plan.stages);
    expect(lowered).toEqual([
      {
        $lookup: {
          from: 'posts',
          localField: '_id',
          foreignField: 'authorId',
          as: 'posts',
        },
      },
    ]);
  });

  it('orders stages: $match → $lookup → $sort → $skip → $limit → $project', () => {
    const state: MongoCollectionState = {
      filters: [MongoFieldFilter.eq('active', true)],
      includes: [
        {
          relationName: 'posts',
          from: 'posts',
          localField: '_id',
          foreignField: 'authorId',
          cardinality: '1:N',
        },
      ],
      orderBy: { name: 1 },
      offset: 10,
      limit: 5,
      selectedFields: ['name', 'email'],
    };
    const plan = compileMongoQuery('users', state);
    const lowered = lowerPipeline(plan.stages);

    const stageKeys = lowered.map((s) => Object.keys(s)[0]);
    expect(stageKeys).toEqual(['$match', '$lookup', '$sort', '$skip', '$limit', '$project']);
  });
});
