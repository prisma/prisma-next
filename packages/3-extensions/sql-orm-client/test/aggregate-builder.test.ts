import { describe, expect, it } from 'vitest';
import { createAggregateBuilder, isAggregateSelector } from '../src/aggregate-builder';
import { getTestContract } from './helpers';

describe('aggregate-builder', () => {
  const contract = getTestContract();

  it('createAggregateBuilder() maps numeric field selectors to storage columns', () => {
    const aggregate = createAggregateBuilder(contract, 'Post');
    const numericField = 'views' as never;

    expect(aggregate.count()).toEqual({
      kind: 'aggregate',
      fn: 'count',
    });
    expect(aggregate.sum(numericField)).toEqual({
      kind: 'aggregate',
      fn: 'sum',
      column: 'views',
    });
    expect(aggregate.avg(numericField)).toEqual({
      kind: 'aggregate',
      fn: 'avg',
      column: 'views',
    });
    expect(aggregate.min(numericField)).toEqual({
      kind: 'aggregate',
      fn: 'min',
      column: 'views',
    });
    expect(aggregate.max(numericField)).toEqual({
      kind: 'aggregate',
      fn: 'max',
      column: 'views',
    });
  });

  it('createAggregateBuilder() falls back to field name without mapping', () => {
    const aggregate = createAggregateBuilder(contract, 'UnknownModel' as never);
    const numericField = 'custom_metric' as never;

    expect(aggregate.sum(numericField)).toEqual({
      kind: 'aggregate',
      fn: 'sum',
      column: 'custom_metric',
    });
  });

  it('isAggregateSelector() validates selector shape', () => {
    expect(isAggregateSelector(null)).toBe(false);
    expect(isAggregateSelector('x')).toBe(false);
    expect(isAggregateSelector({ kind: 'not-aggregate', fn: 'count' })).toBe(false);
    expect(isAggregateSelector({ kind: 'aggregate', fn: 'median' })).toBe(false);
    expect(isAggregateSelector({ kind: 'aggregate', fn: 'count' })).toBe(true);
    expect(isAggregateSelector({ kind: 'aggregate', fn: 'sum', column: 'views' })).toBe(true);
  });
});
