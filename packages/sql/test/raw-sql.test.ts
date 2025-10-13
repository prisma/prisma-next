import { describe, it, expect } from 'vitest';
import { rawSql } from '../src/types';

describe('Raw SQL', () => {
  it('creates a Plan<unknown> for raw SQL', () => {
    const plan = rawSql('SELECT 1 as test');

    expect(plan).toEqual({
      ast: { type: 'select', from: '', projectStar: true },
      sql: 'SELECT 1 as test',
      params: [],
      meta: {
        contractHash: '',
        target: 'postgres',
        refs: { tables: [], columns: [] },
      },
    });
  });

  it('has unknown result type', () => {
    const plan = rawSql('SELECT 1 as test');

    // TypeScript should infer TResult as unknown
    const result: unknown[] = [];
    expect(typeof plan).toBe('object');
  });
});
