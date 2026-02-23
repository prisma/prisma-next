import { runtimeError } from './errors';

/**
 * Custom async iterable result that extends AsyncIterable with a toArray() method.
 * This provides a convenient way to collect all results from an async iterator.
 */
export class AsyncIterableResult<Row> implements AsyncIterable<Row>, PromiseLike<Row[]> {
  private readonly generator: AsyncGenerator<Row, void, unknown>;
  private consumed = false;
  private consumedBy: 'bufferedArray' | 'iterator' | undefined;
  private bufferedArrayPromise: Promise<Row[]> | undefined;

  constructor(generator: AsyncGenerator<Row, void, unknown>) {
    this.generator = generator;
  }

  [Symbol.asyncIterator](): AsyncIterator<Row> {
    if (this.consumed) {
      throw runtimeError(
        'RUNTIME.ITERATOR_CONSUMED',
        `AsyncIterableResult iterator has already been consumed via ${this.consumedBy === 'bufferedArray' ? 'toArray()/then()' : 'for-await loop'}. Each AsyncIterableResult can only be iterated once.`,
        {
          consumedBy: this.consumedBy,
          suggestion:
            this.consumedBy === 'bufferedArray'
              ? 'If you need to iterate multiple times, store the results from toArray() in a variable and reuse that.'
              : 'If you need to iterate multiple times, use toArray() to collect all results first.',
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
  toArray(): Promise<Row[]> {
    if (this.consumedBy === 'iterator') {
      return Promise.reject(
        runtimeError(
          'RUNTIME.ITERATOR_CONSUMED',
          'AsyncIterableResult iterator has already been consumed via for-await loop. Each AsyncIterableResult can only be iterated once.',
          {
            consumedBy: this.consumedBy,
            suggestion:
              'The iterator was already consumed by a for-await loop. Use toArray() or await the result before iterating.',
          },
        ),
      );
    }

    if (this.bufferedArrayPromise) {
      return this.bufferedArrayPromise;
    }

    this.consumed = true;
    this.consumedBy = 'bufferedArray';
    this.bufferedArrayPromise = (async () => {
      const out: Row[] = [];
      for await (const item of this.generator) {
        out.push(item);
      }
      return out;
    })();
    return this.bufferedArrayPromise;
  }

  // biome-ignore lint/suspicious/noThenProperty: PromiseLike implementation is intentional for await support.
  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.toArray().then(onfulfilled, onrejected);
  }
}
