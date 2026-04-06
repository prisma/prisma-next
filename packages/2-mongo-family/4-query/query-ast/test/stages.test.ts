import { describe, expect, it } from 'vitest';
import type { MongoAggExpr } from '../src/aggregation-expressions';
import {
  MongoAggAccumulator,
  MongoAggCond,
  MongoAggFieldRef,
  MongoAggLiteral,
  MongoAggOperator,
} from '../src/aggregation-expressions';
import { MongoFieldFilter } from '../src/filter-expressions';
import {
  MongoAddFieldsStage,
  MongoCountStage,
  MongoGroupStage,
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  MongoProjectStage,
  MongoRedactStage,
  MongoReplaceRootStage,
  MongoSampleStage,
  MongoSkipStage,
  MongoSortByCountStage,
  MongoSortStage,
  MongoUnwindStage,
} from '../src/stages';
import type { MongoAggExprRewriter, MongoFilterRewriter, MongoStageVisitor } from '../src/visitors';

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
    const filter: MongoFilterRewriter = {
      field: (expr) => MongoFieldFilter.of(expr.field, '$gte', expr.value),
    };
    const stage = new MongoMatchStage(MongoFieldFilter.eq('x', 1));
    const rewritten = stage.rewrite({ filter }) as MongoMatchStage;
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

  it('accepts computed projection values (MongoAggExpr)', () => {
    const expr = MongoAggOperator.of('$concat', [
      MongoAggFieldRef.of('first'),
      MongoAggLiteral.of(' '),
      MongoAggFieldRef.of('last'),
    ]);
    const stage = new MongoProjectStage({ fullName: expr, _id: 0 });
    expect(stage.projection['fullName']).toBe(expr);
    expect(stage.projection['_id']).toBe(0);
  });

  it('is frozen', () => {
    const stage = new MongoProjectStage({ name: 1 });
    expect(Object.isFrozen(stage)).toBe(true);
    expect(Object.isFrozen(stage.projection)).toBe(true);
  });

  it('rewrite() returns this for scalar-only projections', () => {
    const stage = new MongoProjectStage({ name: 1 });
    expect(stage.rewrite({})).toBe(stage);
  });

  it('rewrite() recurses into expression projection values', () => {
    const aggExpr: MongoAggExprRewriter = {
      fieldRef: (expr) => MongoAggFieldRef.of(`r.${expr.path}`),
    };
    const stage = new MongoProjectStage({
      fullName: MongoAggFieldRef.of('name'),
      _id: 0,
    });
    const rewritten = stage.rewrite({ aggExpr }) as MongoProjectStage;
    expect((rewritten.projection['fullName'] as MongoAggFieldRef).path).toBe('r.name');
    expect(rewritten.projection['_id']).toBe(0);
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
    const filter: MongoFilterRewriter = {
      field: (expr) => MongoFieldFilter.of(expr.field, '$ne', expr.value),
    };
    const stage = new MongoLookupStage({
      from: 'posts',
      localField: '_id',
      foreignField: 'authorId',
      as: 'posts',
      pipeline: [new MongoMatchStage(MongoFieldFilter.eq('published', true))],
    });
    const rewritten = stage.rewrite({ filter }) as MongoLookupStage;
    const match = rewritten.pipeline![0] as MongoMatchStage;
    expect((match.filter as MongoFieldFilter).op).toBe('$ne');
  });

  it('supports correlated pipeline form with let_', () => {
    const stage = new MongoLookupStage({
      from: 'orders',
      as: 'matchingOrders',
      let_: { userId: MongoAggFieldRef.of('_id') },
      pipeline: [new MongoMatchStage(MongoFieldFilter.eq('status', 'active'))],
    });
    expect(stage.let_).toBeDefined();
    expect((stage.let_!['userId'] as MongoAggFieldRef).path).toBe('_id');
    expect(stage.localField).toBeUndefined();
    expect(stage.foreignField).toBeUndefined();
  });

  it('rewrite() recurses into let_ expressions', () => {
    const aggExpr: MongoAggExprRewriter = {
      fieldRef: (expr) => MongoAggFieldRef.of(`r.${expr.path}`),
    };
    const stage = new MongoLookupStage({
      from: 'orders',
      as: 'matchingOrders',
      let_: { userId: MongoAggFieldRef.of('_id') },
      pipeline: [new MongoMatchStage(MongoFieldFilter.eq('status', 'active'))],
    });
    const rewritten = stage.rewrite({ aggExpr }) as MongoLookupStage;
    expect((rewritten.let_!['userId'] as MongoAggFieldRef).path).toBe('r._id');
  });
});

describe('MongoUnwindStage', () => {
  it('stores path and preserveNullAndEmptyArrays', () => {
    const stage = new MongoUnwindStage('$posts', true);
    expect(stage.kind).toBe('unwind');
    expect(stage.path).toBe('$posts');
    expect(stage.preserveNullAndEmptyArrays).toBe(true);
    expect(stage.includeArrayIndex).toBeUndefined();
  });

  it('supports includeArrayIndex', () => {
    const stage = new MongoUnwindStage('$items', false, 'itemIndex');
    expect(stage.includeArrayIndex).toBe('itemIndex');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new MongoUnwindStage('$posts', false))).toBe(true);
  });

  it('rewrite() returns this (leaf stage)', () => {
    const stage = new MongoUnwindStage('$posts', false);
    expect(stage.rewrite({})).toBe(stage);
  });
});

describe('MongoGroupStage', () => {
  it('stores groupId and accumulators', () => {
    const stage = new MongoGroupStage(MongoAggFieldRef.of('department'), {
      total: MongoAggAccumulator.sum(MongoAggFieldRef.of('amount')),
    });
    expect(stage.kind).toBe('group');
    expect((stage.groupId as MongoAggFieldRef).path).toBe('department');
    expect(stage.accumulators['total']!.op).toBe('$sum');
  });

  it('accepts null groupId for global group', () => {
    const stage = new MongoGroupStage(null, {
      count: MongoAggAccumulator.count(),
    });
    expect(stage.groupId).toBeNull();
  });

  it('accepts compound groupId', () => {
    const stage = new MongoGroupStage(
      { dept: MongoAggFieldRef.of('department'), year: MongoAggFieldRef.of('year') },
      { total: MongoAggAccumulator.sum(MongoAggFieldRef.of('amount')) },
    );
    expect((stage.groupId as Record<string, MongoAggExpr>)['dept']).toBeDefined();
    expect((stage.groupId as Record<string, MongoAggExpr>)['year']).toBeDefined();
  });

  it('is frozen', () => {
    const stage = new MongoGroupStage(MongoAggFieldRef.of('x'), {
      total: MongoAggAccumulator.sum(MongoAggFieldRef.of('y')),
    });
    expect(Object.isFrozen(stage)).toBe(true);
    expect(Object.isFrozen(stage.accumulators)).toBe(true);
  });

  it('rewrite() recurses into groupId and accumulator expressions', () => {
    const aggExpr: MongoAggExprRewriter = {
      fieldRef: (expr) => MongoAggFieldRef.of(`r.${expr.path}`),
    };
    const stage = new MongoGroupStage(MongoAggFieldRef.of('dept'), {
      total: MongoAggAccumulator.sum(MongoAggFieldRef.of('amount')),
    });
    const rewritten = stage.rewrite({ aggExpr }) as MongoGroupStage;
    expect((rewritten.groupId as MongoAggFieldRef).path).toBe('r.dept');
    expect((rewritten.accumulators['total']!.arg as MongoAggFieldRef).path).toBe('r.amount');
  });

  it('rewrite() recurses into compound groupId', () => {
    const aggExpr: MongoAggExprRewriter = {
      fieldRef: (expr) => MongoAggFieldRef.of(`r.${expr.path}`),
    };
    const stage = new MongoGroupStage(
      { dept: MongoAggFieldRef.of('department') },
      { total: MongoAggAccumulator.sum(MongoAggFieldRef.of('amount')) },
    );
    const rewritten = stage.rewrite({ aggExpr }) as MongoGroupStage;
    const compoundId = rewritten.groupId as Record<string, MongoAggExpr>;
    expect((compoundId['dept'] as MongoAggFieldRef).path).toBe('r.department');
  });

  it('rewrite() returns this with empty context', () => {
    const stage = new MongoGroupStage(null, {
      count: MongoAggAccumulator.count(),
    });
    expect(stage.rewrite({})).toBe(stage);
  });
});

describe('MongoAddFieldsStage', () => {
  it('stores computed fields', () => {
    const stage = new MongoAddFieldsStage({
      fullName: MongoAggOperator.of('$concat', [
        MongoAggFieldRef.of('first'),
        MongoAggLiteral.of(' '),
        MongoAggFieldRef.of('last'),
      ]),
    });
    expect(stage.kind).toBe('addFields');
    expect(stage.fields['fullName']).toBeDefined();
  });

  it('is frozen', () => {
    const stage = new MongoAddFieldsStage({ x: MongoAggLiteral.of(1) });
    expect(Object.isFrozen(stage)).toBe(true);
    expect(Object.isFrozen(stage.fields)).toBe(true);
  });

  it('rewrite() recurses into field expressions', () => {
    const aggExpr: MongoAggExprRewriter = {
      fieldRef: (expr) => MongoAggFieldRef.of(`r.${expr.path}`),
    };
    const stage = new MongoAddFieldsStage({ total: MongoAggFieldRef.of('amount') });
    const rewritten = stage.rewrite({ aggExpr }) as MongoAddFieldsStage;
    expect((rewritten.fields['total'] as MongoAggFieldRef).path).toBe('r.amount');
  });

  it('rewrite() returns this with empty context', () => {
    const stage = new MongoAddFieldsStage({ x: MongoAggLiteral.of(1) });
    expect(stage.rewrite({})).toBe(stage);
  });
});

describe('MongoReplaceRootStage', () => {
  it('stores newRoot expression', () => {
    const stage = new MongoReplaceRootStage(MongoAggFieldRef.of('address'));
    expect(stage.kind).toBe('replaceRoot');
    expect((stage.newRoot as MongoAggFieldRef).path).toBe('address');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new MongoReplaceRootStage(MongoAggFieldRef.of('x')))).toBe(true);
  });

  it('rewrite() recurses into newRoot', () => {
    const aggExpr: MongoAggExprRewriter = {
      fieldRef: (expr) => MongoAggFieldRef.of(`r.${expr.path}`),
    };
    const stage = new MongoReplaceRootStage(MongoAggFieldRef.of('address'));
    const rewritten = stage.rewrite({ aggExpr }) as MongoReplaceRootStage;
    expect((rewritten.newRoot as MongoAggFieldRef).path).toBe('r.address');
  });

  it('rewrite() returns this with empty context', () => {
    const stage = new MongoReplaceRootStage(MongoAggLiteral.of(1));
    expect(stage.rewrite({})).toBe(stage);
  });
});

describe('MongoCountStage', () => {
  it('stores field name', () => {
    const stage = new MongoCountStage('total');
    expect(stage.kind).toBe('count');
    expect(stage.field).toBe('total');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new MongoCountStage('total'))).toBe(true);
  });

  it('rewrite() returns this (scalar only)', () => {
    const stage = new MongoCountStage('total');
    expect(stage.rewrite({})).toBe(stage);
  });
});

describe('MongoSortByCountStage', () => {
  it('stores expression', () => {
    const stage = new MongoSortByCountStage(MongoAggFieldRef.of('status'));
    expect(stage.kind).toBe('sortByCount');
    expect((stage.expr as MongoAggFieldRef).path).toBe('status');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new MongoSortByCountStage(MongoAggFieldRef.of('x')))).toBe(true);
  });

  it('rewrite() recurses into expression', () => {
    const aggExpr: MongoAggExprRewriter = {
      fieldRef: (expr) => MongoAggFieldRef.of(`r.${expr.path}`),
    };
    const stage = new MongoSortByCountStage(MongoAggFieldRef.of('status'));
    const rewritten = stage.rewrite({ aggExpr }) as MongoSortByCountStage;
    expect((rewritten.expr as MongoAggFieldRef).path).toBe('r.status');
  });

  it('rewrite() returns this with empty context', () => {
    const stage = new MongoSortByCountStage(MongoAggLiteral.of('x'));
    expect(stage.rewrite({})).toBe(stage);
  });
});

describe('MongoSampleStage', () => {
  it('stores size', () => {
    const stage = new MongoSampleStage(10);
    expect(stage.kind).toBe('sample');
    expect(stage.size).toBe(10);
  });

  it('accepts zero', () => {
    expect(new MongoSampleStage(0).size).toBe(0);
  });

  it('rejects negative values', () => {
    expect(() => new MongoSampleStage(-1)).toThrow(RangeError);
  });

  it('rejects non-integer values', () => {
    expect(() => new MongoSampleStage(1.5)).toThrow(RangeError);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new MongoSampleStage(5))).toBe(true);
  });

  it('rewrite() returns this (scalar only)', () => {
    const stage = new MongoSampleStage(5);
    expect(stage.rewrite({})).toBe(stage);
  });
});

describe('MongoRedactStage', () => {
  it('stores expression', () => {
    const expr = MongoAggCond.of(
      MongoAggOperator.of('$eq', [MongoAggFieldRef.of('level'), MongoAggLiteral.of(5)]),
      MongoAggLiteral.of('$$PRUNE'),
      MongoAggLiteral.of('$$DESCEND'),
    );
    const stage = new MongoRedactStage(expr);
    expect(stage.kind).toBe('redact');
    expect(stage.expr).toBe(expr);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new MongoRedactStage(MongoAggLiteral.of('$$KEEP')))).toBe(true);
  });

  it('rewrite() recurses into expression', () => {
    const aggExpr: MongoAggExprRewriter = {
      fieldRef: (expr) => MongoAggFieldRef.of(`r.${expr.path}`),
    };
    const stage = new MongoRedactStage(MongoAggFieldRef.of('level'));
    const rewritten = stage.rewrite({ aggExpr }) as MongoRedactStage;
    expect((rewritten.expr as MongoAggFieldRef).path).toBe('r.level');
  });

  it('rewrite() returns this with empty context', () => {
    const stage = new MongoRedactStage(MongoAggLiteral.of('$$KEEP'));
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
    group: () => 'group',
    addFields: () => 'addFields',
    replaceRoot: () => 'replaceRoot',
    count: () => 'count',
    sortByCount: () => 'sortByCount',
    sample: () => 'sample',
    redact: () => 'redact',
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

  it('dispatches group', () => {
    const stage = new MongoGroupStage(null, { count: MongoAggAccumulator.count() });
    expect(stage.accept(kindVisitor)).toBe('group');
  });

  it('dispatches addFields', () => {
    expect(new MongoAddFieldsStage({ x: MongoAggLiteral.of(1) }).accept(kindVisitor)).toBe(
      'addFields',
    );
  });

  it('dispatches replaceRoot', () => {
    expect(new MongoReplaceRootStage(MongoAggFieldRef.of('x')).accept(kindVisitor)).toBe(
      'replaceRoot',
    );
  });

  it('dispatches count', () => {
    expect(new MongoCountStage('total').accept(kindVisitor)).toBe('count');
  });

  it('dispatches sortByCount', () => {
    expect(new MongoSortByCountStage(MongoAggFieldRef.of('status')).accept(kindVisitor)).toBe(
      'sortByCount',
    );
  });

  it('dispatches sample', () => {
    expect(new MongoSampleStage(5).accept(kindVisitor)).toBe('sample');
  });

  it('dispatches redact', () => {
    expect(new MongoRedactStage(MongoAggLiteral.of('$$KEEP')).accept(kindVisitor)).toBe('redact');
  });
});
