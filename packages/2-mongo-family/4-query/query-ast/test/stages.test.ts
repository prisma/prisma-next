import { describe, expect, it } from 'vitest';
import { MongoFieldFilter } from '../src/filter-expressions';
import {
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  MongoProjectStage,
  MongoSkipStage,
  MongoSortStage,
  MongoUnwindStage,
} from '../src/stages';
import type { MongoFilterRewriter, MongoStageVisitor } from '../src/visitors';

describe('MongoMatchStage', () => {
  it('wraps a filter expression', () => {
    const filter = MongoFieldFilter.eq('x', 1);
    const stage = new MongoMatchStage(filter);
    expect(stage.kind).toBe('match');
    expect(stage.filter).toBe(filter);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new MongoMatchStage(MongoFieldFilter.eq('x', 1)))).toBe(true);
  });

  it('rewrite() rewrites the embedded filter', () => {
    const rewriter: MongoFilterRewriter = {
      field: (expr) => MongoFieldFilter.of(expr.field, '$gte', expr.value),
    };
    const stage = new MongoMatchStage(MongoFieldFilter.eq('x', 1));
    const rewritten = stage.rewrite(rewriter) as MongoMatchStage;
    expect(rewritten.kind).toBe('match');
    expect((rewritten.filter as MongoFieldFilter).op).toBe('$gte');
  });
});

describe('MongoProjectStage', () => {
  it('stores a projection map', () => {
    const stage = new MongoProjectStage({ name: 1, email: 1, _id: 0 });
    expect(stage.kind).toBe('project');
    expect(stage.projection).toEqual({ name: 1, email: 1, _id: 0 });
  });

  it('is frozen', () => {
    const stage = new MongoProjectStage({ name: 1 });
    expect(Object.isFrozen(stage)).toBe(true);
    expect(Object.isFrozen(stage.projection)).toBe(true);
  });

  it('rewrite() returns this (leaf stage)', () => {
    const stage = new MongoProjectStage({ name: 1 });
    expect(stage.rewrite({})).toBe(stage);
  });
});

describe('MongoSortStage', () => {
  it('stores a sort spec', () => {
    const stage = new MongoSortStage({ age: -1, name: 1 });
    expect(stage.kind).toBe('sort');
    expect(stage.sort).toEqual({ age: -1, name: 1 });
  });

  it('is frozen', () => {
    const stage = new MongoSortStage({ age: -1 });
    expect(Object.isFrozen(stage)).toBe(true);
    expect(Object.isFrozen(stage.sort)).toBe(true);
  });

  it('rewrite() returns this (leaf stage)', () => {
    const stage = new MongoSortStage({ age: -1 });
    expect(stage.rewrite({})).toBe(stage);
  });
});

describe('MongoLimitStage', () => {
  it('stores a limit value', () => {
    const stage = new MongoLimitStage(10);
    expect(stage.kind).toBe('limit');
    expect(stage.limit).toBe(10);
  });

  it('accepts zero', () => {
    expect(new MongoLimitStage(0).limit).toBe(0);
  });

  it('rejects negative values', () => {
    expect(() => new MongoLimitStage(-1)).toThrow(RangeError);
  });

  it('rejects non-integer values', () => {
    expect(() => new MongoLimitStage(1.5)).toThrow(RangeError);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new MongoLimitStage(5))).toBe(true);
  });

  it('rewrite() returns this (leaf stage)', () => {
    const stage = new MongoLimitStage(5);
    expect(stage.rewrite({})).toBe(stage);
  });
});

describe('MongoSkipStage', () => {
  it('stores a skip value', () => {
    const stage = new MongoSkipStage(20);
    expect(stage.kind).toBe('skip');
    expect(stage.skip).toBe(20);
  });

  it('accepts zero', () => {
    expect(new MongoSkipStage(0).skip).toBe(0);
  });

  it('rejects negative values', () => {
    expect(() => new MongoSkipStage(-1)).toThrow(RangeError);
  });

  it('rejects non-integer values', () => {
    expect(() => new MongoSkipStage(2.5)).toThrow(RangeError);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new MongoSkipStage(20))).toBe(true);
  });

  it('rewrite() returns this (leaf stage)', () => {
    const stage = new MongoSkipStage(20);
    expect(stage.rewrite({})).toBe(stage);
  });
});

describe('MongoLookupStage', () => {
  it('stores lookup config', () => {
    const stage = new MongoLookupStage({
      from: 'posts',
      localField: '_id',
      foreignField: 'authorId',
      as: 'posts',
    });
    expect(stage.kind).toBe('lookup');
    expect(stage.from).toBe('posts');
    expect(stage.localField).toBe('_id');
    expect(stage.foreignField).toBe('authorId');
    expect(stage.as).toBe('posts');
    expect(stage.pipeline).toBeUndefined();
  });

  it('supports nested pipeline', () => {
    const stage = new MongoLookupStage({
      from: 'posts',
      localField: '_id',
      foreignField: 'authorId',
      as: 'posts',
      pipeline: [new MongoMatchStage(MongoFieldFilter.eq('published', true))],
    });
    expect(stage.pipeline).toHaveLength(1);
  });

  it('is frozen', () => {
    const stage = new MongoLookupStage({
      from: 'posts',
      localField: '_id',
      foreignField: 'authorId',
      as: 'posts',
      pipeline: [new MongoMatchStage(MongoFieldFilter.eq('x', 1))],
    });
    expect(Object.isFrozen(stage)).toBe(true);
    expect(Object.isFrozen(stage.pipeline)).toBe(true);
  });

  it('rewrite() returns this when no pipeline', () => {
    const stage = new MongoLookupStage({
      from: 'posts',
      localField: '_id',
      foreignField: 'authorId',
      as: 'posts',
    });
    expect(stage.rewrite({})).toBe(stage);
  });

  it('rewrite() rewrites nested pipeline stages', () => {
    const rewriter: MongoFilterRewriter = {
      field: (expr) => MongoFieldFilter.of(expr.field, '$ne', expr.value),
    };
    const stage = new MongoLookupStage({
      from: 'posts',
      localField: '_id',
      foreignField: 'authorId',
      as: 'posts',
      pipeline: [new MongoMatchStage(MongoFieldFilter.eq('published', true))],
    });
    const rewritten = stage.rewrite(rewriter) as MongoLookupStage;
    const match = rewritten.pipeline![0] as MongoMatchStage;
    expect((match.filter as MongoFieldFilter).op).toBe('$ne');
  });
});

describe('MongoUnwindStage', () => {
  it('stores path and preserveNullAndEmptyArrays', () => {
    const stage = new MongoUnwindStage('$posts', true);
    expect(stage.kind).toBe('unwind');
    expect(stage.path).toBe('$posts');
    expect(stage.preserveNullAndEmptyArrays).toBe(true);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new MongoUnwindStage('$posts', false))).toBe(true);
  });

  it('rewrite() returns this (leaf stage)', () => {
    const stage = new MongoUnwindStage('$posts', false);
    expect(stage.rewrite({})).toBe(stage);
  });
});

describe('MongoStageVisitor', () => {
  const kindVisitor: MongoStageVisitor<string> = {
    match: () => 'match',
    project: () => 'project',
    sort: () => 'sort',
    limit: () => 'limit',
    skip: () => 'skip',
    lookup: () => 'lookup',
    unwind: () => 'unwind',
  };

  it('dispatches match', () => {
    expect(new MongoMatchStage(MongoFieldFilter.eq('x', 1)).accept(kindVisitor)).toBe('match');
  });

  it('dispatches project', () => {
    expect(new MongoProjectStage({ x: 1 }).accept(kindVisitor)).toBe('project');
  });

  it('dispatches sort', () => {
    expect(new MongoSortStage({ x: 1 }).accept(kindVisitor)).toBe('sort');
  });

  it('dispatches limit', () => {
    expect(new MongoLimitStage(10).accept(kindVisitor)).toBe('limit');
  });

  it('dispatches skip', () => {
    expect(new MongoSkipStage(5).accept(kindVisitor)).toBe('skip');
  });

  it('dispatches lookup', () => {
    const stage = new MongoLookupStage({
      from: 'posts',
      localField: '_id',
      foreignField: 'authorId',
      as: 'posts',
    });
    expect(stage.accept(kindVisitor)).toBe('lookup');
  });

  it('dispatches unwind', () => {
    expect(new MongoUnwindStage('$posts', true).accept(kindVisitor)).toBe('unwind');
  });
});
