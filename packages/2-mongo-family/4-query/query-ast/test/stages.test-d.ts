import { assertType, expectTypeOf, test } from 'vitest';
import type { MongoAggAccumulator, MongoAggExpr } from '../src/aggregation-expressions';
import type {
  MongoAddFieldsStage,
  MongoCountStage,
  MongoGroupStage,
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  MongoProjectionValue,
  MongoProjectStage,
  MongoReadStage,
  MongoRedactStage,
  MongoReplaceRootStage,
  MongoSampleStage,
  MongoSkipStage,
  MongoSortByCountStage,
  MongoSortStage,
  MongoUnwindStage,
} from '../src/stages';
import type { MongoStageVisitor } from '../src/visitors';

test('each concrete stage class is assignable to MongoReadStage', () => {
  expectTypeOf<MongoMatchStage>().toExtend<MongoReadStage>();
  expectTypeOf<MongoProjectStage>().toExtend<MongoReadStage>();
  expectTypeOf<MongoSortStage>().toExtend<MongoReadStage>();
  expectTypeOf<MongoLimitStage>().toExtend<MongoReadStage>();
  expectTypeOf<MongoSkipStage>().toExtend<MongoReadStage>();
  expectTypeOf<MongoLookupStage>().toExtend<MongoReadStage>();
  expectTypeOf<MongoUnwindStage>().toExtend<MongoReadStage>();
  expectTypeOf<MongoGroupStage>().toExtend<MongoReadStage>();
  expectTypeOf<MongoAddFieldsStage>().toExtend<MongoReadStage>();
  expectTypeOf<MongoReplaceRootStage>().toExtend<MongoReadStage>();
  expectTypeOf<MongoCountStage>().toExtend<MongoReadStage>();
  expectTypeOf<MongoSortByCountStage>().toExtend<MongoReadStage>();
  expectTypeOf<MongoSampleStage>().toExtend<MongoReadStage>();
  expectTypeOf<MongoRedactStage>().toExtend<MongoReadStage>();
});

test('MongoReadStage kind union covers all 14 kinds', () => {
  expectTypeOf<MongoReadStage['kind']>().toEqualTypeOf<
    | 'match'
    | 'project'
    | 'sort'
    | 'limit'
    | 'skip'
    | 'lookup'
    | 'unwind'
    | 'group'
    | 'addFields'
    | 'replaceRoot'
    | 'count'
    | 'sortByCount'
    | 'sample'
    | 'redact'
  >();
});

test('switching on kind is exhaustive', () => {
  function exhaustiveSwitch(stage: MongoReadStage): string {
    switch (stage.kind) {
      case 'match':
        return 'match';
      case 'project':
        return 'project';
      case 'sort':
        return 'sort';
      case 'limit':
        return 'limit';
      case 'skip':
        return 'skip';
      case 'lookup':
        return 'lookup';
      case 'unwind':
        return 'unwind';
      case 'group':
        return 'group';
      case 'addFields':
        return 'addFields';
      case 'replaceRoot':
        return 'replaceRoot';
      case 'count':
        return 'count';
      case 'sortByCount':
        return 'sortByCount';
      case 'sample':
        return 'sample';
      case 'redact':
        return 'redact';
      default: {
        const _exhaustive: never = stage;
        return _exhaustive;
      }
    }
  }
  assertType<(stage: MongoReadStage) => string>(exhaustiveSwitch);
});

test('MongoStageVisitor requires all 14 methods', () => {
  type Complete = MongoStageVisitor<string>;

  expectTypeOf<Complete>().toHaveProperty('match');
  expectTypeOf<Complete>().toHaveProperty('project');
  expectTypeOf<Complete>().toHaveProperty('sort');
  expectTypeOf<Complete>().toHaveProperty('limit');
  expectTypeOf<Complete>().toHaveProperty('skip');
  expectTypeOf<Complete>().toHaveProperty('lookup');
  expectTypeOf<Complete>().toHaveProperty('unwind');
  expectTypeOf<Complete>().toHaveProperty('group');
  expectTypeOf<Complete>().toHaveProperty('addFields');
  expectTypeOf<Complete>().toHaveProperty('replaceRoot');
  expectTypeOf<Complete>().toHaveProperty('count');
  expectTypeOf<Complete>().toHaveProperty('sortByCount');
  expectTypeOf<Complete>().toHaveProperty('sample');
  expectTypeOf<Complete>().toHaveProperty('redact');

  // @ts-expect-error - missing 'match' method
  assertType<MongoStageVisitor<string>>({
    project: () => '',
    sort: () => '',
    limit: () => '',
    skip: () => '',
    lookup: () => '',
    unwind: () => '',
    group: () => '',
    addFields: () => '',
    replaceRoot: () => '',
    count: () => '',
    sortByCount: () => '',
    sample: () => '',
    redact: () => '',
  });
});

test('MongoGroupStage.accumulators requires MongoAggAccumulator values', () => {
  expectTypeOf<MongoGroupStage['accumulators']>().toEqualTypeOf<
    Readonly<Record<string, MongoAggAccumulator>>
  >();
});

test('MongoProjectionValue allows 0, 1, or MongoAggExpr', () => {
  expectTypeOf<0>().toExtend<MongoProjectionValue>();
  expectTypeOf<1>().toExtend<MongoProjectionValue>();
  expectTypeOf<MongoAggExpr>().toExtend<MongoProjectionValue>();

  // @ts-expect-error - 2 is not a valid projection value
  assertType<MongoProjectionValue>(2);

  // @ts-expect-error - string is not a valid projection value
  assertType<MongoProjectionValue>('include');
});

test('accept returns R for any visitor R', () => {
  const stage = {} as unknown as MongoMatchStage;
  const visitor: MongoStageVisitor<number> = {
    match: () => 1,
    project: () => 2,
    sort: () => 3,
    limit: () => 4,
    skip: () => 5,
    lookup: () => 6,
    unwind: () => 7,
    group: () => 8,
    addFields: () => 9,
    replaceRoot: () => 10,
    count: () => 11,
    sortByCount: () => 12,
    sample: () => 13,
    redact: () => 14,
  };
  expectTypeOf(stage.accept(visitor)).toBeNumber();
});
