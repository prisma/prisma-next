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
import type { MongoAggExprRewriter, MongoStageVisitor } from '../src/visitors';

function prefixFieldRefRewriter(prefix: string): MongoAggExprRewriter {
  return { fieldRef: (expr) => MongoAggFieldRef.of(`${prefix}${expr.path}`) };
}

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

  it('rewrite() handles compound groupId with a "kind" key correctly', () => {
    const aggExpr = prefixFieldRefRewriter('r.');
    const stage = new MongoGroupStage(
      { kind: MongoAggFieldRef.of('type'), dept: MongoAggFieldRef.of('department') },
      { total: MongoAggAccumulator.sum(MongoAggFieldRef.of('amount')) },
    );
    const rewritten = stage.rewrite({ aggExpr }) as MongoGroupStage;
    const compoundId = rewritten.groupId as Record<string, MongoAggExpr>;
    expect((compoundId['kind'] as MongoAggFieldRef).path).toBe('r.type');
    expect((compoundId['dept'] as MongoAggFieldRef).path).toBe('r.department');
  });

  it('is frozen', () => {
    const stage = new MongoGroupStage(MongoAggFieldRef.of('x'), {
      total: MongoAggAccumulator.sum(MongoAggFieldRef.of('y')),
    });
    expect(Object.isFrozen(stage)).toBe(true);
    expect(Object.isFrozen(stage.accumulators)).toBe(true);
  });

  it('rewrite() recurses into groupId and accumulator expressions', () => {
    const aggExpr = prefixFieldRefRewriter('r.');
    const stage = new MongoGroupStage(MongoAggFieldRef.of('dept'), {
      total: MongoAggAccumulator.sum(MongoAggFieldRef.of('amount')),
    });
    const rewritten = stage.rewrite({ aggExpr }) as MongoGroupStage;
    expect((rewritten.groupId as MongoAggFieldRef).path).toBe('r.dept');
    expect((rewritten.accumulators['total']!.arg as MongoAggFieldRef).path).toBe('r.amount');
  });

  it('rewrite() recurses into compound groupId', () => {
    const aggExpr = prefixFieldRefRewriter('r.');
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
    const aggExpr = prefixFieldRefRewriter('r.');
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
    const aggExpr = prefixFieldRefRewriter('r.');
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
    const aggExpr = prefixFieldRefRewriter('r.');
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
    const aggExpr = prefixFieldRefRewriter('r.');
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
