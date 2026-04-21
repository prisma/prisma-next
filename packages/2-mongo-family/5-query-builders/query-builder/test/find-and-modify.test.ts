import {
  FindOneAndDeleteCommand,
  FindOneAndUpdateCommand,
  UpdateOneCommand,
} from '@prisma-next/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { mongoQuery } from '../src/query';
import type { TContract } from './fixtures/test-contract';
import { testContractJson } from './fixtures/test-contract';

const orders = () => mongoQuery<TContract>({ contractJson: testContractJson }).from('orders');

describe('M3 find-and-modify and upsert terminals', () => {
  describe('FilteredCollection.findOneAndUpdate', () => {
    it('emits FindOneAndUpdateCommand with the folded filter and update spec', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .findOneAndUpdate((f) => [f.status.set('processed'), f.amount.inc(1)]);
      expect(plan.command).toBeInstanceOf(FindOneAndUpdateCommand);
      expect(plan.command.collection).toBe('orders');
      expect(plan.command.update).toEqual({ $set: { status: 'processed' }, $inc: { amount: 1 } });
      expect(plan.command.upsert).toBe(false);
      expect(plan.meta.lane).toBe('mongo-query');
    });

    it('threads opts.upsert through to the wire command', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .findOneAndUpdate((f) => [f.status.set('seen')], { upsert: true });
      expect(plan.command.upsert).toBe(true);
    });

    it('defaults returnDocument to after', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .findOneAndUpdate((f) => [f.status.set('seen')]);
      expect(plan.command.returnDocument).toBe('after');
    });

    it('threads opts.returnDocument through to the wire command', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .findOneAndUpdate((f) => [f.status.set('seen')], { returnDocument: 'before' });
      expect(plan.command.returnDocument).toBe('before');
    });

    it('rejects an empty updater (caller almost certainly forgot something)', () => {
      expect(() =>
        orders()
          .match((f) => f.status.eq('new'))
          .findOneAndUpdate(() => []),
      ).toThrow(/at least one update/);
    });
  });

  describe('FilteredCollection.findOneAndDelete', () => {
    it('emits FindOneAndDeleteCommand with the folded filter', () => {
      const plan = orders()
        .match((f) => f.status.eq('archived'))
        .findOneAndDelete();
      expect(plan.command).toBeInstanceOf(FindOneAndDeleteCommand);
      expect(plan.command.collection).toBe('orders');
    });
  });

  describe('PipelineChain.findOneAndUpdate (chain deconstruction)', () => {
    it('deconstructs match + sort into wire-command slots', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .sort({ amount: -1 })
        .findOneAndUpdate((f) => [f.status.set('processed')]);
      expect(plan.command).toBeInstanceOf(FindOneAndUpdateCommand);
      expect(plan.command.sort).toEqual({ amount: -1 });
      expect(plan.command.update).toEqual({ $set: { status: 'processed' } });
    });

    it('AND-folds multiple match stages', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .match((f) => f.amount.gt(10))
        .findOneAndUpdate((f) => [f.status.set('big')]);
      expect(plan.command.filter.kind).toBe('and');
    });

    it('rejects multiple sort stages (canonical shape allows at most one)', () => {
      const chain = orders()
        .match((f) => f.status.eq('new'))
        .sort({ amount: 1 })
        .sort({ amount: -1 });
      expect(() => chain.findOneAndUpdate((f) => [f.status.set('seen')])).toThrow(
        /at most one \$sort stage/,
      );
    });

    it('rejects a $match that follows a $sort (non-canonical ordering)', () => {
      const chain = orders()
        .match((f) => f.status.eq('new'))
        .sort({ amount: -1 })
        .match((f) => f.amount.gt(10)) as unknown as ReturnType<typeof orders>;
      expect(() => chain.findOneAndUpdate((f) => [f.status.set('bad')])).toThrow(
        /\$match\+ -> \$sort\? shape/,
      );
    });

    it('rejects .skip() stages outright (MongoDB findAndModify has no skip slot)', () => {
      const chain = orders()
        .match((f) => f.status.eq('new'))
        .skip(5) as unknown as ReturnType<typeof orders>;
      expect(() => chain.findOneAndUpdate((f) => [f.status.set('bad')])).toThrow(
        /does not support \.skip\(\)/,
      );
    });

    it('throws on chains with non-deconstructable stages', () => {
      const chain = orders()
        .match((f) => f.status.eq('new'))
        .addFields(() => ({})) as unknown as ReturnType<typeof orders>;
      expect(() => chain.findOneAndUpdate((f) => [f.status.set('bad')])).toThrow(
        /\$match\+ -> \$sort\? shape/,
      );
    });
  });

  describe('PipelineChain.findOneAndDelete (chain deconstruction)', () => {
    it('deconstructs match + sort into wire-command slots', () => {
      const plan = orders()
        .match((f) => f.status.eq('archived'))
        .sort({ amount: 1 })
        .findOneAndDelete();
      expect(plan.command).toBeInstanceOf(FindOneAndDeleteCommand);
      expect(plan.command.sort).toEqual({ amount: 1 });
    });
  });

  describe('upsertOne', () => {
    it('CollectionHandle.upsertOne emits UpdateOneCommand with upsert=true and the supplied filter', () => {
      const plan = orders().upsertOne(
        (f) => f.status.eq('pending'),
        (f) => [f.amount.set(0)],
      );
      expect(plan.command).toBeInstanceOf(UpdateOneCommand);
      expect(plan.command.upsert).toBe(true);
      expect(plan.command.update).toEqual({ $set: { amount: 0 } });
    });

    it('FilteredCollection.upsertOne reuses the accumulated filter', () => {
      const plan = orders()
        .match((f) => f.status.eq('pending'))
        .upsertOne((f) => [f.amount.set(0)]);
      expect(plan.command).toBeInstanceOf(UpdateOneCommand);
      expect(plan.command.upsert).toBe(true);
    });
  });
});
