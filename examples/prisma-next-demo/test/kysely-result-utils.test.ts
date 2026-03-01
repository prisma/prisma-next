import { describe, expect, it } from 'vitest';
import { firstOrNull, firstOrThrow } from '../src/result-utils';

async function* asyncRows<T>(rows: readonly T[]): AsyncGenerator<T, void, unknown> {
  for (const row of rows) {
    yield row;
  }
}

describe('result utils', () => {
  it('firstOrNull returns first row', async () => {
    const row = await firstOrNull(asyncRows([{ id: 1 }, { id: 2 }]));
    expect(row).toEqual({ id: 1 });
  });

  it('firstOrNull returns null when empty', async () => {
    const row = await firstOrNull(asyncRows([]));
    expect(row).toBeNull();
  });

  it('firstOrThrow returns first row', async () => {
    const row = await firstOrThrow(asyncRows([{ id: 1 }, { id: 2 }]));
    expect(row).toEqual({ id: 1 });
  });

  it('firstOrThrow throws when empty', async () => {
    await expect(firstOrThrow(asyncRows([]))).rejects.toThrow('Expected at least one row');
  });
});
