import { describe, expect, it } from 'vitest';
import { AsyncIterableResult } from '../src/async-iterable-result';

describe('AsyncIterableResult', () => {
  it('works with for await loop', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      yield 1;
      yield 2;
      yield 3;
    }

    const result = new AsyncIterableResult(generateItems());
    const items: number[] = [];

    for await (const item of result) {
      items.push(item);
    }

    expect(items).toEqual([1, 2, 3]);
  });

  it('toArray collects all values correctly', async () => {
    async function* generateItems(): AsyncGenerator<string, void, unknown> {
      yield 'a';
      yield 'b';
      yield 'c';
    }

    const result = new AsyncIterableResult(generateItems());
    const items = await result.toArray();

    expect(items).toEqual(['a', 'b', 'c']);
  });

  it('handles empty results', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      // No items
    }

    const result = new AsyncIterableResult(generateItems());
    const items = await result.toArray();

    expect(items).toEqual([]);
  });

  it('handles empty results with for await', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      // No items
    }

    const result = new AsyncIterableResult(generateItems());
    const items: number[] = [];

    for await (const item of result) {
      items.push(item);
    }

    expect(items).toEqual([]);
  });

  it('propagates errors during iteration with for await', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      yield 1;
      throw new Error('Test error');
    }

    const result = new AsyncIterableResult(generateItems());
    const items: number[] = [];

    await expect(async () => {
      for await (const item of result) {
        items.push(item);
      }
    }).rejects.toThrow('Test error');

    expect(items).toEqual([1]);
  });

  it('propagates errors during iteration with toArray', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      yield 1;
      throw new Error('Test error');
    }

    const result = new AsyncIterableResult(generateItems());

    await expect(result.toArray()).rejects.toThrow('Test error');
  });

  it('preserves type information', async () => {
    interface TestRow {
      readonly id: number;
      readonly name: string;
    }

    async function* generateItems(): AsyncGenerator<TestRow, void, unknown> {
      yield { id: 1, name: 'test' };
      yield { id: 2, name: 'test2' };
    }

    const result = new AsyncIterableResult(generateItems());
    const items = await result.toArray();

    expect(items).toEqual([
      { id: 1, name: 'test' },
      { id: 2, name: 'test2' },
    ]);

    // Type check: items should be TestRow[]
    const firstItem = items[0];
    if (firstItem) {
      expect(typeof firstItem.id).toBe('number');
      expect(typeof firstItem.name).toBe('string');
    }
  });

  it('throws error when iterating after toArray', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      yield 1;
      yield 2;
      yield 3;
    }

    const result = new AsyncIterableResult(generateItems());
    await result.toArray();

    // Iterator is consumed, so iterating again should throw an error
    await expect(async () => {
      for await (const _item of result) {
        // Should not reach here
      }
    }).rejects.toThrow('AsyncIterableResult iterator has already been consumed');
  });

  it('throws error when calling toArray twice', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      yield 1;
      yield 2;
      yield 3;
    }

    const result = new AsyncIterableResult(generateItems());
    await result.toArray();

    // Calling toArray() again should throw an error
    await expect(result.toArray()).rejects.toThrow(
      'AsyncIterableResult iterator has already been consumed',
    );
  });

  it('throws error when iterating after for await', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      yield 1;
      yield 2;
      yield 3;
    }

    const result = new AsyncIterableResult(generateItems());

    // First iteration
    const items1: number[] = [];
    for await (const item of result) {
      items1.push(item);
    }
    expect(items1).toEqual([1, 2, 3]);

    // Second iteration should throw an error
    await expect(async () => {
      for await (const _item of result) {
        // Should not reach here
      }
    }).rejects.toThrow('AsyncIterableResult iterator has already been consumed');
  });

  it('throws error when calling toArray after for await', async () => {
    async function* generateItems(): AsyncGenerator<number, void, unknown> {
      yield 1;
      yield 2;
      yield 3;
    }

    const result = new AsyncIterableResult(generateItems());

    // First iteration via for-await
    const items1: number[] = [];
    for await (const item of result) {
      items1.push(item);
    }
    expect(items1).toEqual([1, 2, 3]);

    // Calling toArray() after iterator was consumed should throw an error
    await expect(result.toArray()).rejects.toThrow(
      'AsyncIterableResult iterator has already been consumed',
    );
  });
});
