import { describe, expect, it } from 'vitest';
import { normalizeAggregateResult } from '../src/collection-aggregate-result';

describe('collection-aggregate-result', () => {
  it('normalizeAggregateResult() coerces values across aggregate output types', () => {
    const spec = {
      count: { kind: 'aggregate', fn: 'count' as const },
      total: { kind: 'aggregate', fn: 'sum' as const, column: 'views' },
      avg: { kind: 'aggregate', fn: 'avg' as const, column: 'views' },
      min: { kind: 'aggregate', fn: 'min' as const, column: 'views' },
      max: { kind: 'aggregate', fn: 'max' as const, column: 'views' },
      passthrough: { kind: 'aggregate', fn: 'sum' as const, column: 'views' },
    } as const;

    const result = normalizeAggregateResult(spec, {
      count: undefined,
      total: 10n,
      avg: '2.5',
      min: null,
      max: 'not-a-number',
      passthrough: { raw: true },
    });

    expect(result).toEqual({
      count: 0,
      total: 10,
      avg: 2.5,
      min: null,
      max: 'not-a-number',
      passthrough: { raw: true },
    });
  });

  it('normalizeAggregateResult() defaults non-count undefined values to null', () => {
    const spec = {
      total: { kind: 'aggregate', fn: 'sum' as const, column: 'views' },
    } as const;

    expect(normalizeAggregateResult(spec, {})).toEqual({
      total: null,
    });
  });
});
