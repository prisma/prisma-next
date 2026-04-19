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
      const cmd = plan.command as FindOneAndUpdateCommand;
      expect(cmd.collection).toBe('orders');
      expect(cmd.update).toEqual({ $set: { status: 'processed' }, $inc: { amount: 1 } });
      // Default upsert is false — explicit guard so the default change is loud.
      expect(cmd.upsert).toBe(false);
      expect(plan.meta.lane).toBe('mongo-write');
    });

    it('threads opts.upsert through to the wire command', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .findOneAndUpdate((f) => [f.status.set('seen')], { upsert: true });
      expect((plan.command as FindOneAndUpdateCommand).upsert).toBe(true);
    });

    it('defaults returnDocument to after', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .findOneAndUpdate((f) => [f.status.set('seen')]);
      expect((plan.command as FindOneAndUpdateCommand).returnDocument).toBe('after');
    });

    it('threads opts.returnDocument through to the wire command', () => {
      const plan = orders()
        .match((f) => f.status.eq('new'))
        .findOneAndUpdate((f) => [f.status.set('seen')], { returnDocument: 'before' });
      expect((plan.command as FindOneAndUpdateCommand).returnDocument).toBe('before');
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
      expect((plan.command as FindOneAndDeleteCommand).collection).toBe('orders');
    });
  });

  describe('upsertOne', () => {
    it('CollectionHandle.upsertOne emits UpdateOneCommand with upsert=true and the supplied filter', () => {
      const plan = orders().upsertOne(
        (f) => f.status.eq('pending'),
        (f) => [f.amount.set(0)],
      );
      expect(plan.command).toBeInstanceOf(UpdateOneCommand);
      const cmd = plan.command as UpdateOneCommand;
      expect(cmd.upsert).toBe(true);
      expect(cmd.update).toEqual({ $set: { amount: 0 } });
    });

    it('FilteredCollection.upsertOne reuses the accumulated filter', () => {
      const plan = orders()
        .match((f) => f.status.eq('pending'))
        .upsertOne((f) => [f.amount.set(0)]);
      expect(plan.command).toBeInstanceOf(UpdateOneCommand);
      expect((plan.command as UpdateOneCommand).upsert).toBe(true);
    });
  });
});
