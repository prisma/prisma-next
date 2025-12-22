import { runtimeError } from './errors';

/**
 * Custom async iterable result that extends AsyncIterable with a toArray() method.
 * This provides a convenient way to collect all results from an async iterator.
 */
export class AsyncIterableResult<Row> implements AsyncIterable<Row> {
  private readonly generator: AsyncGenerator<Row, void, unknown>;
  private consumed = false;
  private consumedBy: 'toArray' | 'iterator' | undefined;

  constructor(generator: AsyncGenerator<Row, void, unknown>) {
    this.generator = generator;
  }

  [Symbol.asyncIterator](): AsyncIterator<Row> {
    if (this.consumed) {
      throw runtimeError(
        'RUNTIME.ITERATOR_CONSUMED',
        `AsyncIterableResult iterator has already been consumed via ${this.consumedBy === 'toArray' ? 'toArray()' : 'for-await loop'}. Each AsyncIterableResult can only be iterated once.`,
        {
          consumedBy: this.consumedBy,
          suggestion:
            this.consumedBy === 'toArray'
              ? 'If you need to iterate multiple times, call runtime.execute() again to get a new AsyncIterableResult, or store the results from toArray() in a variable and reuse that.'
              : 'If you need to iterate multiple times, call runtime.execute() again to get a new AsyncIterableResult, or use toArray() to collect all results first.',
        },
      );
    }
    this.consumed = true;
    this.consumedBy = 'iterator';
    return this.generator;
  }

  /**
   * Collects all values from the async iterator into an array.
   * Once called, the iterator is consumed and cannot be reused.
   */
  async toArray(): Promise<Row[]> {
    if (this.consumed) {
      throw runtimeError(
        'RUNTIME.ITERATOR_CONSUMED',
        `AsyncIterableResult iterator has already been consumed via ${this.consumedBy === 'toArray' ? 'toArray()' : 'for-await loop'}. Each AsyncIterableResult can only be iterated once.`,
        {
          consumedBy: this.consumedBy,
          suggestion:
            this.consumedBy === 'toArray'
              ? 'You cannot call toArray() twice on the same AsyncIterableResult. Store the result from the first call in a variable and reuse that.'
              : 'The iterator was already consumed by a for-await loop. Call runtime.execute() again to get a new AsyncIterableResult, or use toArray() before iterating.',
        },
      );
    }
    this.consumed = true;
    this.consumedBy = 'toArray';
    const out: Row[] = [];
    for await (const item of this.generator) {
      out.push(item);
    }
    return out;
  }
}
