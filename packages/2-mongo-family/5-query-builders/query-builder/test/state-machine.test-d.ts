import { MongoFieldFilter } from '@prisma-next/mongo-query-ast/execution';
import { describe, expectTypeOf, it } from 'vitest';
import type { PipelineChain } from '../src/builder';
import type { FindAndModifyEnabled, UpdateEnabled } from '../src/markers';
import { mongoQuery } from '../src/query';
import type { CollectionHandle, FilteredCollection } from '../src/state-classes';
import type { TContract } from './fixtures/test-contract';

const contractJson = {} as unknown;

/**
 * Extract the `UpdateEnabled` marker from any `PipelineChain` (or subclass).
 * Used by the marker-table assertions below to interrogate transition results
 * without having to reconstruct the full `Shape` parameter at the call site.
 */
type GetU<T> =
  T extends PipelineChain<infer _TContract, infer _Shape, infer U, infer _F> ? U : never;

type GetF<T> =
  T extends PipelineChain<infer _TContract, infer _Shape, infer _U, infer F> ? F : never;

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
    expectTypeOf<GetU<typeof limited>>().toEqualTypeOf<'update-cleared' & UpdateEnabled>();
    expectTypeOf<GetF<typeof limited>>().toEqualTypeOf<'fam-cleared' & FindAndModifyEnabled>();
  });

  it('marker table: addFields preserves UpdateEnabled, clears FindAndModifyEnabled', () => {
    const added = mongoQuery<TContract>({ contractJson })
      .from('orders')
      .addFields((f) => ({ doubled: f.amount }));
    expectTypeOf<GetU<typeof added>>().toEqualTypeOf<'update-ok' & UpdateEnabled>();
    expectTypeOf<GetF<typeof added>>().toEqualTypeOf<'fam-cleared' & FindAndModifyEnabled>();
  });

  it('marker table: sort preserves FindAndModifyEnabled, clears UpdateEnabled', () => {
    const sorted = mongoQuery<TContract>({ contractJson }).from('orders').sort({ amount: -1 });
    expectTypeOf<GetU<typeof sorted>>().toEqualTypeOf<'update-cleared' & UpdateEnabled>();
    expectTypeOf<GetF<typeof sorted>>().toEqualTypeOf<'fam-ok' & FindAndModifyEnabled>();
  });

  it('marker table: group clears both markers', () => {
    const grouped = mongoQuery<TContract>({ contractJson })
      .from('orders')
      .group((_f) => ({ _id: null }));
    expectTypeOf<GetU<typeof grouped>>().toEqualTypeOf<'update-cleared' & UpdateEnabled>();
    expectTypeOf<GetF<typeof grouped>>().toEqualTypeOf<'fam-cleared' & FindAndModifyEnabled>();
  });
});
