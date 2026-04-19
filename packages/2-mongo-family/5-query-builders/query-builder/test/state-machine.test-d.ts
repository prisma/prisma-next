import { MongoFieldFilter } from '@prisma-next/mongo-query-ast/execution';
import { describe, expectTypeOf, it } from 'vitest';
import type { PipelineChain } from '../src/builder';
import type { FindAndModifyCompat, UpdateCompat } from '../src/markers';
import { mongoQuery } from '../src/query';
import type { CollectionHandle, FilteredCollection } from '../src/state-classes';
import type { TContract } from './fixtures/test-contract';

const contractJson = {} as unknown;

/**
 * Extract the `UpdateCompat` marker from any `PipelineChain` (or subclass).
 * Used by the marker-table assertions below to interrogate transition results
 * without having to reconstruct the full `Shape` parameter at the call site.
 */
type GetU<T> =
  T extends PipelineChain<
    // biome-ignore lint/suspicious/noExplicitAny: phantom-marker probe
    any,
    // biome-ignore lint/suspicious/noExplicitAny: phantom-marker probe
    any,
    infer U,
    // biome-ignore lint/suspicious/noExplicitAny: phantom-marker probe
    any
  >
    ? U
    : never;

type GetF<T> =
  T extends PipelineChain<
    // biome-ignore lint/suspicious/noExplicitAny: phantom-marker probe
    any,
    // biome-ignore lint/suspicious/noExplicitAny: phantom-marker probe
    any,
    // biome-ignore lint/suspicious/noExplicitAny: phantom-marker probe
    any,
    infer F
  >
    ? F
    : never;

describe('state machine', () => {
  it('from(name) returns CollectionHandle (root state) inheriting PipelineChain', () => {
    const handle = mongoQuery<TContract>({ contractJson }).from('orders');
    expectTypeOf(handle).toExtend<CollectionHandle<TContract, 'Order'>>();
  });

  it('CollectionHandle.match(...) transitions to FilteredCollection', () => {
    const filtered = mongoQuery<TContract>({ contractJson })
      .from('orders')
      .match(MongoFieldFilter.eq('status', 'active'));
    expectTypeOf(filtered).toExtend<FilteredCollection<TContract, 'Order'>>();
  });

  it('FilteredCollection.match(...) stays in FilteredCollection (AND-folds)', () => {
    const filtered = mongoQuery<TContract>({ contractJson })
      .from('orders')
      .match(MongoFieldFilter.eq('status', 'active'))
      .match(MongoFieldFilter.gt('amount', 100));
    expectTypeOf(filtered).toExtend<FilteredCollection<TContract, 'Order'>>();
  });

  it('pipeline-stage methods drop out of the state-class subclasses', () => {
    const sorted = mongoQuery<TContract>({ contractJson }).from('orders').sort({ amount: -1 });
    // No longer a CollectionHandle/FilteredCollection — write/find-and-modify
    // surfaces have been left behind.
    expectTypeOf(sorted).not.toExtend<CollectionHandle<TContract, 'Order'>>();
    expectTypeOf(sorted).not.toExtend<FilteredCollection<TContract, 'Order'>>();
  });

  it('marker table: limit() clears both markers', () => {
    const limited = mongoQuery<TContract>({ contractJson }).from('orders').limit(1);
    expectTypeOf<GetU<typeof limited>>().toEqualTypeOf<'cleared' & UpdateCompat>();
    expectTypeOf<GetF<typeof limited>>().toEqualTypeOf<'cleared' & FindAndModifyCompat>();
  });

  it('marker table: addFields preserves UpdateCompat, clears FindAndModifyCompat', () => {
    const added = mongoQuery<TContract>({ contractJson })
      .from('orders')
      .addFields((f) => ({ doubled: f.amount }));
    expectTypeOf<GetU<typeof added>>().toEqualTypeOf<'compat' & UpdateCompat>();
    expectTypeOf<GetF<typeof added>>().toEqualTypeOf<'cleared' & FindAndModifyCompat>();
  });

  it('marker table: sort preserves FindAndModifyCompat, clears UpdateCompat', () => {
    const sorted = mongoQuery<TContract>({ contractJson }).from('orders').sort({ amount: -1 });
    expectTypeOf<GetU<typeof sorted>>().toEqualTypeOf<'cleared' & UpdateCompat>();
    expectTypeOf<GetF<typeof sorted>>().toEqualTypeOf<'compat' & FindAndModifyCompat>();
  });

  it('marker table: group clears both markers', () => {
    const grouped = mongoQuery<TContract>({ contractJson })
      .from('orders')
      .group((_f) => ({ _id: null }));
    expectTypeOf<GetU<typeof grouped>>().toEqualTypeOf<'cleared' & UpdateCompat>();
    expectTypeOf<GetF<typeof grouped>>().toEqualTypeOf<'cleared' & FindAndModifyCompat>();
  });
});
