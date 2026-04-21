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
  it('CollectionHandle does not expose filtered-only terminals', () => {
    const h = handle();
    // @ts-expect-error — `deleteMany` requires a `.match(...)` first
    h.deleteMany();
    // @ts-expect-error — `deleteOne` requires a `.match(...)` first
    h.deleteOne();
  });

  it('findOneAndUpdate / findOneAndDelete unavailable after FindAndModifyEnabled-clearing stages', () => {
    // .group() clears both markers
    const grouped = handle()
      .match(MongoFieldFilter.eq('status', 'new'))
      .group(() => ({ _id: null }));
    // @ts-expect-error — group clears FindAndModifyEnabled
    grouped.findOneAndUpdate((f) => [f.amount.inc(1)]);
    // @ts-expect-error — group clears FindAndModifyEnabled
    grouped.findOneAndDelete();

    // .limit() clears both markers
    const limited = handle().match(MongoFieldFilter.eq('status', 'new')).limit(1);
    // @ts-expect-error — limit clears FindAndModifyEnabled
    limited.findOneAndUpdate((f) => [f.amount.inc(1)]);
    // @ts-expect-error — limit clears FindAndModifyEnabled
    limited.findOneAndDelete();

    // .addFields() clears FindAndModifyEnabled
    const withAddFields = handle()
      .match(MongoFieldFilter.eq('status', 'new'))
      .addFields(() => ({}));
    // @ts-expect-error — addFields clears FindAndModifyEnabled
    withAddFields.findOneAndUpdate((f) => [f.amount.inc(1)]);
    // @ts-expect-error — addFields clears FindAndModifyEnabled
    withAddFields.findOneAndDelete();

    // .project() clears FindAndModifyEnabled
    const projected = handle().match(MongoFieldFilter.eq('status', 'new')).project('status');
    // @ts-expect-error — project clears FindAndModifyEnabled
    projected.findOneAndUpdate((f) => [f.amount.inc(1)]);
    // @ts-expect-error — project clears FindAndModifyEnabled
    projected.findOneAndDelete();

    // .unwind() clears both markers
    const unwound = handle()
      .match(MongoFieldFilter.eq('status', 'new'))
      .unwind('tags' as never);
    // @ts-expect-error — unwind clears FindAndModifyEnabled
    unwound.findOneAndUpdate((f) => [f.amount.inc(1)]);
    // @ts-expect-error — unwind clears FindAndModifyEnabled
    unwound.findOneAndDelete();
  });

  it('no-arg updateMany / updateOne unavailable after UpdateEnabled-clearing stages', () => {
    // .group() clears both markers
    const grouped = handle()
      .match(MongoFieldFilter.eq('status', 'new'))
      .group(() => ({ _id: null }));
    // @ts-expect-error — group clears UpdateEnabled
    grouped.updateMany();
    // @ts-expect-error — group clears UpdateEnabled
    grouped.updateOne();

    // .limit() clears both markers
    const limited = handle().match(MongoFieldFilter.eq('status', 'new')).limit(1);
    // @ts-expect-error — limit clears UpdateEnabled
    limited.updateMany();
    // @ts-expect-error — limit clears UpdateEnabled
    limited.updateOne();

    // .sort() clears UpdateEnabled (preserves FindAndModifyEnabled)
    const sorted = handle().match(MongoFieldFilter.eq('status', 'new')).sort({ amount: -1 });
    // @ts-expect-error — sort clears UpdateEnabled
    sorted.updateMany();
    // @ts-expect-error — sort clears UpdateEnabled
    sorted.updateOne();

    // .match(...).addFields(...).match(...) — the second .match() sits past
    // the leading-match prefix. `deconstructUpdateChain` only peels *leading*
    // `$match` stages into the wire-command filter, so the chain must clear
    // UpdateEnabled at the type level to stop the no-arg write terminals
    // compiling (even though each individual stage preserves UpdateEnabled).
    const pastLeadingMatch = handle()
      .match(MongoFieldFilter.eq('status', 'new'))
      .addFields((f) => ({ doubled: f.amount }))
      .match(MongoFieldFilter.gt('amount', 100));
    // @ts-expect-error — match past the leading-match prefix clears UpdateEnabled
    pastLeadingMatch.updateMany();
    // @ts-expect-error — match past the leading-match prefix clears UpdateEnabled
    pastLeadingMatch.updateOne();
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
