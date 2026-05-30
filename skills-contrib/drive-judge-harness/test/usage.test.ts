import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { accumulateUsage, emptyTotals, type TurnUsage } from '../usage.ts';

describe('accumulateUsage', () => {
  it('returns all-zero totals for no updates', () => {
    assert.deepEqual(accumulateUsage([]), emptyTotals());
  });

  it('sums a single update into the totals', () => {
    const totals = accumulateUsage([
      { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1 },
    ]);
    assert.deepEqual(totals, {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      totalTokens: 18,
    });
  });

  it('sums across multiple updates', () => {
    const updates: TurnUsage[] = [
      { inputTokens: 100, outputTokens: 40, cacheReadTokens: 10, cacheWriteTokens: 5 },
      { inputTokens: 50, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 5 },
    ];
    const totals = accumulateUsage(updates);
    assert.equal(totals.inputTokens, 150);
    assert.equal(totals.outputTokens, 60);
    assert.equal(totals.cacheReadTokens, 10);
    assert.equal(totals.cacheWriteTokens, 10);
    assert.equal(totals.totalTokens, 230);
  });

  it('treats missing counters as zero', () => {
    const totals = accumulateUsage([{ inputTokens: 7 }, { outputTokens: 3 }]);
    assert.equal(totals.inputTokens, 7);
    assert.equal(totals.outputTokens, 3);
    assert.equal(totals.cacheReadTokens, 0);
    assert.equal(totals.cacheWriteTokens, 0);
    assert.equal(totals.totalTokens, 10);
  });

  it('treats null and non-finite counters as zero', () => {
    const totals = accumulateUsage([
      { inputTokens: null, outputTokens: Number.NaN, cacheReadTokens: 4 },
    ]);
    assert.equal(totals.inputTokens, 0);
    assert.equal(totals.outputTokens, 0);
    assert.equal(totals.cacheReadTokens, 4);
    assert.equal(totals.totalTokens, 4);
  });
});
