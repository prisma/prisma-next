import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';
import {
  type MongoAndExpr,
  MongoFieldFilter,
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  type MongoPipelineStage,
  MongoProjectStage,
  MongoSkipStage,
  MongoSortStage,
  MongoUnwindStage,
} from '@prisma-next/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import type { MongoCollectionState } from '../src/collection-state';
import { emptyCollectionState } from '../src/collection-state';
import { compileMongoQuery } from '../src/compile';

const testHash = 'test-hash';

function stages(plan: MongoQueryPlan): ReadonlyArray<MongoPipelineStage> {
  if (plan.command.kind !== 'aggregate')
    throw new Error(`Expected aggregate, got ${plan.command.kind}`);
  return plan.command.pipeline;
}

describe('compileMongoQuery', () => {
  it('produces empty pipeline from empty state', () => {
    const plan = compileMongoQuery('users', emptyCollectionState(), testHash);
    expect(plan.collection).toBe('users');
    expect(plan.command.kind).toBe('aggregate');
    expect(stages(plan)).toEqual([]);
    expect(plan.meta.lane).toBe('mongo-orm');
    expect(plan.meta.storageHash).toBe(testHash);
  });

  it('compiles a single filter to $match', () => {
    const state: MongoCollectionState = {
      ...emptyCollectionState(),
      filters: [MongoFieldFilter.eq('name', 'Alice')],
    };
    const plan = compileMongoQuery('users', state, testHash);
    expect(stages(plan)).toHaveLength(1);
    const match = stages(plan)[0] as MongoMatchStage;
    expect(match).toBeInstanceOf(MongoMatchStage);
    expect(match.filter.kind).toBe('field');
  });

  it('combines multiple filters with $and', () => {
    const state: MongoCollectionState = {
      ...emptyCollectionState(),
      filters: [MongoFieldFilter.eq('name', 'Alice'), MongoFieldFilter.gte('age', 18)],
    };
    const plan = compileMongoQuery('users', state, testHash);
    expect(stages(plan)).toHaveLength(1);
    const match = stages(plan)[0] as MongoMatchStage;
    expect(match.filter.kind).toBe('and');
    expect((match.filter as MongoAndExpr).exprs).toHaveLength(2);
  });

  it('compiles selectedFields to $project with _id suppressed', () => {
    const state: MongoCollectionState = {
      ...emptyCollectionState(),
      selectedFields: ['name', 'email'],
    };
    const plan = compileMongoQuery('users', state, testHash);
    expect(stages(plan)).toHaveLength(1);
    const project = stages(plan)[0] as MongoProjectStage;
    expect(project).toBeInstanceOf(MongoProjectStage);
    expect(project.projection).toEqual({ name: 1, email: 1, _id: 0 });
  });

  it('preserves _id when explicitly selected', () => {
    const state: MongoCollectionState = {
      ...emptyCollectionState(),
      selectedFields: ['_id', 'name'],
    };
    const plan = compileMongoQuery('users', state, testHash);
    const project = stages(plan)[0] as MongoProjectStage;
    expect(project.projection).toEqual({ _id: 1, name: 1 });
  });

  it('skips $project when selectedFields is empty', () => {
    const state: MongoCollectionState = {
      ...emptyCollectionState(),
      selectedFields: [],
    };
    const plan = compileMongoQuery('users', state, testHash);
    expect(stages(plan)).toEqual([]);
  });

  it('compiles orderBy to $sort', () => {
    const state: MongoCollectionState = {
      ...emptyCollectionState(),
      orderBy: { age: -1, name: 1 },
    };
    const plan = compileMongoQuery('users', state, testHash);
    expect(stages(plan)).toHaveLength(1);
    const sort = stages(plan)[0] as MongoSortStage;
    expect(sort).toBeInstanceOf(MongoSortStage);
    expect(sort.sort).toEqual({ age: -1, name: 1 });
  });

  it('compiles limit to $limit', () => {
    const state: MongoCollectionState = {
      ...emptyCollectionState(),
      limit: 10,
    };
    const plan = compileMongoQuery('users', state, testHash);
    expect(stages(plan)).toHaveLength(1);
    const limit = stages(plan)[0] as MongoLimitStage;
    expect(limit).toBeInstanceOf(MongoLimitStage);
    expect(limit.limit).toBe(10);
  });

  it('compiles offset to $skip', () => {
    const state: MongoCollectionState = {
      ...emptyCollectionState(),
      offset: 5,
    };
    const plan = compileMongoQuery('users', state, testHash);
    expect(stages(plan)).toHaveLength(1);
    const skip = stages(plan)[0] as MongoSkipStage;
    expect(skip).toBeInstanceOf(MongoSkipStage);
    expect(skip.skip).toBe(5);
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
    const plan = compileMongoQuery('posts', state, testHash);
    expect(stages(plan)).toHaveLength(2);
    const lookup = stages(plan)[0] as MongoLookupStage;
    expect(lookup).toBeInstanceOf(MongoLookupStage);
    expect(lookup.from).toBe('users');
    expect(lookup.localField).toBe('authorId');
    expect(lookup.foreignField).toBe('_id');
    expect(lookup.as).toBe('author');
    const unwind = stages(plan)[1] as MongoUnwindStage;
    expect(unwind).toBeInstanceOf(MongoUnwindStage);
    expect(unwind.path).toBe('$author');
    expect(unwind.preserveNullAndEmptyArrays).toBe(true);
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
    const plan = compileMongoQuery('users', state, testHash);
    expect(stages(plan)).toHaveLength(1);
    expect(stages(plan)[0]).toBeInstanceOf(MongoLookupStage);
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
      selectedFields: ['_id', 'name', 'email'],
    };
    const plan = compileMongoQuery('users', state, testHash);

    const stageKinds = stages(plan).map((s) => s.kind);
    expect(stageKinds).toEqual(['match', 'lookup', 'sort', 'skip', 'limit', 'project']);
  });
});
