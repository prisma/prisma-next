import {
  AggregateCommand,
  MongoAddFieldsStage,
  MongoAggAccumulator,
  MongoAggFieldRef,
  MongoAggOperator,
  MongoCountStage,
  MongoFieldFilter,
  MongoGroupStage,
  MongoLimitStage,
  MongoMatchStage,
  MongoProjectStage,
  MongoReplaceRootStage,
  MongoSampleStage,
  MongoSkipStage,
  MongoSortByCountStage,
  MongoSortStage,
  MongoUnwindStage,
} from '@prisma-next/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { acc } from '../src/accumulator-helpers';
import { fn } from '../src/expression-helpers';
import { mongoQuery } from '../src/query';
import type { TContract } from './fixtures/test-contract';
import { testContractJson } from './fixtures/test-contract';

function createOrdersBuilder() {
  return mongoQuery<TContract>({ contractJson: testContractJson }).from('orders');
}

describe('PipelineChain', () => {
  describe('build()', () => {
    it('produces AggregateCommand with correct collection', () => {
      const plan = createOrdersBuilder().build();
      expect(plan.collection).toBe('orders');
      expect(plan.command).toBeInstanceOf(AggregateCommand);
      expect((plan.command as AggregateCommand).collection).toBe('orders');
    });

    it('produces PlanMeta with lane: mongo-query', () => {
      const plan = createOrdersBuilder().build();
      expect(plan.meta.lane).toBe('mongo-query');
      expect(plan.meta.target).toBe('mongo');
      expect(plan.meta.storageHash).toBe('test-hash');
    });
  });

  describe('identity stages', () => {
    it('match(filter) appends MongoMatchStage', () => {
      const filter = MongoFieldFilter.eq('status', 'active');
      const plan = createOrdersBuilder().match(filter).build();
      const pipeline = (plan.command as AggregateCommand).pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoMatchStage);
    });

    it('match(callback) appends MongoMatchStage', () => {
      const plan = createOrdersBuilder()
        .match((f) => f.status.eq('active'))
        .build();
      const pipeline = (plan.command as AggregateCommand).pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoMatchStage);
    });

    it('sort() appends MongoSortStage', () => {
      const plan = createOrdersBuilder().sort({ amount: -1 }).build();
      const pipeline = (plan.command as AggregateCommand).pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoSortStage);
      expect((pipeline[0] as MongoSortStage).sort).toEqual({ amount: -1 });
    });

    it('limit() appends MongoLimitStage', () => {
      const plan = createOrdersBuilder().limit(10).build();
      const pipeline = (plan.command as AggregateCommand).pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoLimitStage);
      expect((pipeline[0] as MongoLimitStage).limit).toBe(10);
    });

    it('skip() appends MongoSkipStage', () => {
      const plan = createOrdersBuilder().skip(5).build();
      const pipeline = (plan.command as AggregateCommand).pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoSkipStage);
      expect((pipeline[0] as MongoSkipStage).skip).toBe(5);
    });

    it('sample() appends MongoSampleStage', () => {
      const plan = createOrdersBuilder().sample(3).build();
      const pipeline = (plan.command as AggregateCommand).pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoSampleStage);
      expect((pipeline[0] as MongoSampleStage).size).toBe(3);
    });
  });

  describe('addFields()', () => {
    it('produces MongoAddFieldsStage with correct expressions', () => {
      const plan = createOrdersBuilder()
        .addFields((f) => ({
          fullName: fn.concat(f.status, fn.literal(' ')),
        }))
        .build();
      const pipeline = (plan.command as AggregateCommand).pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoAddFieldsStage);
      const stage = pipeline[0] as MongoAddFieldsStage;
      expect(stage.fields).toHaveProperty('fullName');
      expect(stage.fields['fullName']).toBeInstanceOf(MongoAggOperator);
    });
  });

  describe('project()', () => {
    it('inclusion form produces MongoProjectStage', () => {
      const plan = createOrdersBuilder().project('status', 'amount').build();
      const pipeline = (plan.command as AggregateCommand).pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoProjectStage);
      const stage = pipeline[0] as MongoProjectStage;
      expect(stage.projection).toEqual({ status: 1, amount: 1 });
    });

    it('computed form produces MongoProjectStage with expressions', () => {
      const plan = createOrdersBuilder()
        .project((f) => ({
          status: 1 as const,
          upper: fn.toUpper(f.status),
        }))
        .build();
      const pipeline = (plan.command as AggregateCommand).pipeline;
      expect(pipeline).toHaveLength(1);
      const stage = pipeline[0] as MongoProjectStage;
      expect(stage.projection['status']).toBe(1);
      expect(stage.projection['upper']).toBeInstanceOf(MongoAggOperator);
    });
  });

  describe('group()', () => {
    it('produces MongoGroupStage with accumulators', () => {
      const plan = createOrdersBuilder()
        .group((f) => ({
          _id: f.customerId,
          total: acc.sum(f.amount),
          orderCount: acc.count(),
        }))
        .build();
      const pipeline = (plan.command as AggregateCommand).pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoGroupStage);
      const stage = pipeline[0] as MongoGroupStage;
      expect(stage.groupId).toBeInstanceOf(MongoAggFieldRef);
      expect(stage.accumulators).toHaveProperty('total');
      expect(stage.accumulators).toHaveProperty('orderCount');
      expect(stage.accumulators['total']).toBeInstanceOf(MongoAggAccumulator);
      expect(stage.accumulators['orderCount']).toBeInstanceOf(MongoAggAccumulator);
    });

    it('rejects null for non-_id keys', () => {
      expect(() =>
        createOrdersBuilder().group((f) => ({
          _id: f.customerId,
          total: null as ReturnType<typeof acc.sum> | null,
        })),
      ).toThrow('must not be null');
    });

    it('rejects non-accumulator expressions for non-_id keys', () => {
      expect(() =>
        createOrdersBuilder().group((f) => ({
          _id: f.customerId,
          total: f.amount as ReturnType<typeof acc.sum>,
        })),
      ).toThrow('must use an accumulator');
    });

    it('handles _id: null for whole-collection grouping', () => {
      const plan = createOrdersBuilder()
        .group((f) => ({
          _id: null,
          total: acc.sum(f.amount),
        }))
        .build();
      const stage = (plan.command as AggregateCommand).pipeline[0] as MongoGroupStage;
      expect(stage.groupId).toBeNull();
    });
  });

  describe('unwind()', () => {
    it('produces MongoUnwindStage', () => {
      const plan = createOrdersBuilder().unwind('status').build();
      const pipeline = (plan.command as AggregateCommand).pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoUnwindStage);
      expect((pipeline[0] as MongoUnwindStage).path).toBe('$status');
    });

    it('passes preserveNullAndEmptyArrays option', () => {
      const plan = createOrdersBuilder()
        .unwind('status', { preserveNullAndEmptyArrays: true })
        .build();
      const stage = (plan.command as AggregateCommand).pipeline[0] as MongoUnwindStage;
      expect(stage.preserveNullAndEmptyArrays).toBe(true);
    });
  });

  describe('count()', () => {
    it('produces MongoCountStage', () => {
      const plan = createOrdersBuilder().count('total').build();
      const pipeline = (plan.command as AggregateCommand).pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoCountStage);
      expect((pipeline[0] as MongoCountStage).field).toBe('total');
    });
  });

  describe('sortByCount()', () => {
    it('produces MongoSortByCountStage', () => {
      const plan = createOrdersBuilder()
        .sortByCount((f) => f.status)
        .build();
      const pipeline = (plan.command as AggregateCommand).pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoSortByCountStage);
    });
  });

  describe('lookup()', () => {
    it('throws for unknown root', () => {
      expect(() =>
        createOrdersBuilder().lookup({
          from: 'nonexistent' as 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'items',
        }),
      ).toThrow('lookup() unknown root: "nonexistent"');
    });
  });

  describe('replaceRoot()', () => {
    it('produces MongoReplaceRootStage', () => {
      const plan = createOrdersBuilder()
        .replaceRoot((f) => f.status)
        .build();
      const pipeline = (plan.command as AggregateCommand).pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoReplaceRootStage);
    });
  });

  describe('pipe()', () => {
    it('appends raw stage preserving shape', () => {
      const rawStage = new MongoLimitStage(5);
      const plan = createOrdersBuilder().pipe(rawStage).build();
      const pipeline = (plan.command as AggregateCommand).pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoLimitStage);
    });
  });

  describe('chaining', () => {
    it('chains multiple stages correctly', () => {
      const plan = createOrdersBuilder()
        .match((f) => f.status.eq('active'))
        .sort({ amount: -1 })
        .limit(10)
        .build();
      const pipeline = (plan.command as AggregateCommand).pipeline;
      expect(pipeline).toHaveLength(3);
      expect(pipeline[0]).toBeInstanceOf(MongoMatchStage);
      expect(pipeline[1]).toBeInstanceOf(MongoSortStage);
      expect(pipeline[2]).toBeInstanceOf(MongoLimitStage);
    });
  });
});

describe('mongoQuery()', () => {
  it('from() creates builder for known root', () => {
    const p = mongoQuery<TContract>({ contractJson: testContractJson });
    const builder = p.from('orders');
    const plan = builder.build();
    expect(plan.collection).toBe('orders');
  });

  it('from() throws for unknown root', () => {
    const p = mongoQuery<TContract>({ contractJson: testContractJson });
    expect(() => p.from('nonexistent' as 'orders')).toThrow('Unknown root');
  });
});
