import {
  MongoAddFieldsStage,
  MongoProjectStage,
  MongoReplaceRootStage,
  UpdateManyCommand,
  UpdateOneCommand,
} from '@prisma-next/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { mongoQuery } from '../src/query';
import type { TContract } from './fixtures/test-contract';
import { testContractJson } from './fixtures/test-contract';

const orders = () => mongoQuery<TContract>({ contractJson: testContractJson }).from('orders');

describe('F3 pipeline-style updates', () => {
  describe('f.stage emitters', () => {
    it('f.stage.set returns MongoAddFieldsStage', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .updateMany((f) => [f.stage.set({ total: f.amount.node })]);
      const cmd = plan.command;
      expect(cmd.update).toHaveLength(1);
      expect((cmd.update as ReadonlyArray<unknown>)[0]).toBeInstanceOf(MongoAddFieldsStage);
    });

    it('f.stage.unset returns MongoProjectStage with exclusions', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .updateMany((f) => [f.stage.unset('amount', 'status')]);
      const cmd = plan.command;
      expect(cmd.update).toHaveLength(1);
      const stage = (cmd.update as ReadonlyArray<unknown>)[0] as MongoProjectStage;
      expect(stage).toBeInstanceOf(MongoProjectStage);
      expect(stage.projection).toEqual({ amount: 0, status: 0 });
    });

    it('f.stage.replaceRoot returns MongoReplaceRootStage', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .updateMany((f) => [f.stage.replaceRoot(f.amount.node)]);
      const cmd = plan.command;
      expect((cmd.update as ReadonlyArray<unknown>)[0]).toBeInstanceOf(MongoReplaceRootStage);
    });

    it('f.stage.replaceWith is an alias for replaceRoot', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .updateMany((f) => [f.stage.replaceWith(f.amount.node)]);
      const cmd = plan.command;
      expect((cmd.update as ReadonlyArray<unknown>)[0]).toBeInstanceOf(MongoReplaceRootStage);
    });
  });

  describe('mixed updater detection', () => {
    it('throws when mixing TypedUpdateOp and pipeline stages', () => {
      expect(() =>
        orders()
          .match((f) => f.status.eq('new'))
          // biome-ignore lint/suspicious/noExplicitAny: deliberately mixing types to test runtime guard
          .updateMany((f) => [f.status.set('done'), f.stage.set({ total: f.amount.node })] as any),
      ).toThrow(/Cannot mix/);
    });
  });

  describe('no-arg PipelineChain.updateMany()', () => {
    it('deconstructs leading $match + trailing pipeline stages into UpdateManyCommand', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .addFields((f) => ({ total: f.amount }))
        .updateMany();
      expect(plan.command).toBeInstanceOf(UpdateManyCommand);
      const cmd = plan.command;
      expect(cmd.update).toHaveLength(1);
      expect((cmd.update as ReadonlyArray<unknown>)[0]).toBeInstanceOf(MongoAddFieldsStage);
      expect(plan.meta.lane).toBe('mongo-query');
    });

    it('AND-folds multiple $match stages in the filter', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .match((f) => f.amount.gt(10))
        .addFields((f) => ({ total: f.amount }))
        .updateMany();
      const cmd = plan.command;
      expect(cmd.filter.kind).toBe('and');
    });

    it('throws without any .match() stages', () => {
      // biome-ignore lint/suspicious/noExplicitAny: bypassing type system to test runtime guard
      expect(() => (orders().addFields((f) => ({ total: f.amount })) as any).updateMany()).toThrow(
        /at least one .match/,
      );
    });

    it('throws on non-update stages forced via cast (defensive runtime check)', () => {
      const chain = orders()
        .match((f) => f.status.eq('new'))
        .sort({ amount: -1 });
      // biome-ignore lint/suspicious/noExplicitAny: bypassing type system to test runtime guard
      expect(() => (chain as any).updateMany()).toThrow(/non-update stage/);
    });

    it('throws on non-update stages after $match', () => {
      const chain = orders()
        .match((f) => f.status.eq('new'))
        .sort({ amount: -1 }) as unknown as ReturnType<typeof orders>;
      expect(() => chain.updateMany()).toThrow(/non-update stage/);
    });
  });

  describe('no-arg PipelineChain.updateOne()', () => {
    it('maps to UpdateOneCommand', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .addFields((f) => ({ total: f.amount }))
        .updateOne();
      expect(plan.command).toBeInstanceOf(UpdateOneCommand);
    });
  });
});
