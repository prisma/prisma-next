import { MongoFieldFilter } from '@prisma-next/mongo-query-ast/execution';
import { describe, it } from 'vitest';
import { mongoQuery } from '../src/query';
import type { TContract } from './fixtures/test-contract';

const contractJson = {} as unknown;
const handle = () => mongoQuery<TContract>({ contractJson }).from('orders');
const filtered = () => handle().match(MongoFieldFilter.eq('status', 'new'));

/**
 * Negative-surface type tests for the M1 state machine + M2 write methods.
 *
 * The point is to lock down which methods *don't* exist on each state, so a
 * misuse like `mongoQuery(...).from('x').updateMany(...)` (writing to every
 * doc through the wrong terminal) doesn't typecheck. Each `@ts-expect-error`
 * here is load-bearing — its absence would silently re-open a footgun the
 * spec set out to close.
 */
describe('state-machine surface (negative type tests)', () => {
  it('CollectionHandle does not expose filtered-write or find-and-modify terminals', () => {
    const h = handle();
    // @ts-expect-error — `updateMany` requires a `.match(...)` first
    h.updateMany((f) => [f.amount.inc(1)]);
    // @ts-expect-error — `updateOne` requires a `.match(...)` first
    h.updateOne((f) => [f.amount.inc(1)]);
    // @ts-expect-error — `deleteMany` requires a `.match(...)` first
    h.deleteMany();
    // @ts-expect-error — `deleteOne` requires a `.match(...)` first
    h.deleteOne();
  });

  it('CollectionHandle does not expose findOneAndUpdate / findOneAndDelete', () => {
    const h = handle();
    // @ts-expect-error — find-and-modify requires a `.match(...)` first
    h.findOneAndUpdate((f) => [f.amount.inc(1)]);
    // @ts-expect-error — find-and-modify requires a `.match(...)` first
    h.findOneAndDelete();
  });

  it('FilteredCollection does not expose insert / unqualified-write terminals', () => {
    const f = filtered();
    // @ts-expect-error — inserts ignore filters; not meaningful after `.match(...)`
    f.insertOne({ status: 'new' });
    // @ts-expect-error — inserts ignore filters; not meaningful after `.match(...)`
    f.insertMany([{ status: 'new' }]);
    // @ts-expect-error — `updateAll` is the unqualified form; the qualified
    // form on `FilteredCollection` is `.updateMany(...)`
    f.updateAll((u) => [u.amount.set(0)]);
    // @ts-expect-error — `deleteAll` is the unqualified form; the qualified
    // form on `FilteredCollection` is `.deleteMany()`
    f.deleteAll();
  });
});
