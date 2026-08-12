import type { AggregateResult, AggregateSelector } from './types';

export function normalizeAggregateResult<Spec extends Record<string, AggregateSelector<unknown>>>(
  aggregateSpec: Spec,
  row: Record<string, unknown>,
): AggregateResult<Spec> {
  const result: Record<string, unknown> = {};

  for (const [alias, selector] of Object.entries(aggregateSpec)) {
    const value = row[alias];
    if (value === null) {
      result[alias] = null;
      continue;
    }

    if (value === undefined) {
      result[alias] = selector.fn === 'count' ? 0 : null;
      continue;
    }

    if (typeof value === 'number') {
      result[alias] = value;
      continue;
    }

    if (typeof value === 'bigint') {
      result[alias] = Number(value);
      continue;
    }

    if (typeof value === 'string') {
      const numeric = Number(value);
      result[alias] = Number.isNaN(numeric) ? value : numeric;
      continue;
    }

    result[alias] = value;
  }

  return result as AggregateResult<Spec>;
}
