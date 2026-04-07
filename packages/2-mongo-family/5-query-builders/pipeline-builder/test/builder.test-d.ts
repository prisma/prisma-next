import type { MongoFilterExpr, MongoQueryPlan } from '@prisma-next/mongo-query-ast';
import { expectTypeOf } from 'vitest';
import { acc } from '../src/accumulator-helpers';
import { fn } from '../src/expression-helpers';
import { mongoPipeline } from '../src/pipeline';
import type { TContract } from './fixtures/test-contract';

const contractJson = {} as unknown;

describe('builder type tests', () => {
  it('build() produces correctly typed MongoQueryPlan', () => {
    const p = mongoPipeline<TContract>({ contractJson });
    const plan = p.from('orders').build();
    expectTypeOf(plan).toMatchTypeOf<MongoQueryPlan>();
  });

  it('identity stages preserve shape', () => {
    const p = mongoPipeline<TContract>({ contractJson });
    const builder = p
      .from('orders')
      .match((f) => f.status.eq('active') as MongoFilterExpr)
      .sort({ amount: -1 })
      .limit(10)
      .skip(0)
      .sample(5);

    const plan = builder.build();
    expectTypeOf(plan).toMatchTypeOf<MongoQueryPlan>();
  });

  it('sort() only accepts keys from current shape', () => {
    const p = mongoPipeline<TContract>({ contractJson });
    const builder = p.from('orders');
    builder.sort({ amount: -1 });
    builder.sort({ status: 1 });
    // @ts-expect-error -- 'bogus' is not in shape
    builder.sort({ bogus: 1 });
  });

  it('group() replaces shape — previous fields inaccessible', () => {
    const p = mongoPipeline<TContract>({ contractJson });
    const grouped = p.from('orders').group((f) => ({
      _id: f.customerId,
      total: acc.sum(f.amount),
      orderCount: acc.count(),
    }));

    grouped.sort({ total: -1 });
    grouped.sort({ orderCount: 1 });

    // @ts-expect-error -- 'status' no longer exists after group
    grouped.sort({ status: 1 });
    // @ts-expect-error -- 'amount' no longer exists after group
    grouped.sort({ amount: 1 });
  });

  it('addFields() extends shape', () => {
    const p = mongoPipeline<TContract>({ contractJson });
    const extended = p.from('orders').addFields((f) => ({
      fullName: fn.concat(f.status, fn.literal(' ')),
    }));

    extended.sort({ status: 1 });
    extended.sort({ fullName: 1 });
  });

  it('project() inclusion narrows shape', () => {
    const p = mongoPipeline<TContract>({ contractJson });
    const projected = p.from('orders').project('status', 'amount');

    projected.sort({ status: 1 });
    projected.sort({ amount: 1 });

    // @ts-expect-error -- 'customerId' was projected out
    projected.sort({ customerId: 1 });
  });

  it('count() replaces shape with single field', () => {
    const p = mongoPipeline<TContract>({ contractJson });
    const counted = p.from('orders').count('total');

    counted.sort({ total: 1 });
    // @ts-expect-error -- only 'total' exists
    counted.sort({ status: 1 });
  });

  it('fn.concat returns string-typed expression', () => {
    const p = mongoPipeline<TContract>({ contractJson });
    const extended = p.from('orders').addFields((f) => ({
      upper: fn.toUpper(f.status),
    }));
    extended.sort({ upper: 1 });
  });

  it('lookup() adds array field and preserves existing fields', () => {
    const p = mongoPipeline<TContract>({ contractJson });
    const withLookup = p.from('orders').lookup({
      from: 'users',
      localField: 'customerId',
      foreignField: '_id',
      as: 'customer',
    });

    withLookup.sort({ status: 1 });
    withLookup.sort({ amount: -1 });
    withLookup.sort({ customer: 1 });

    // @ts-expect-error -- 'bogus' is not in shape
    withLookup.sort({ bogus: 1 });
  });

  it('replaceRoot() replaces entire shape', () => {
    const p = mongoPipeline<TContract>({ contractJson });
    type NewShape = {
      readonly x: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    };
    const replaced = p.from('orders').replaceRoot<NewShape>((f) => f.status);

    replaced.sort({ x: 1 });

    // @ts-expect-error -- 'status' no longer exists after replaceRoot
    replaced.sort({ status: 1 });
  });
});
