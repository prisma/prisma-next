/**
 * Custom async iterable result that extends AsyncIterable with a toArray() method.
 * This provides a convenient way to collect all results from an async iterator.
 */
export class AsyncIterableResult<Row> implements AsyncIterable<Row> {
  private readonly generator: AsyncGenerator<Row, void, unknown>;

  constructor(generator: AsyncGenerator<Row, void, unknown>) {
    this.generator = generator;
  }

  [Symbol.asyncIterator](): AsyncIterator<Row> {
    return this.generator;
  }

  /**
   * Collects all values from the async iterator into an array.
   * Once called, the iterator is consumed and cannot be reused.
   */
  async toArray(): Promise<Row[]> {
    const out: Row[] = [];
    for await (const item of this.generator) {
      out.push(item);
    }
    return out;
  }
}
