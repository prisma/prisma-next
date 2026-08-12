/**
 * A fully lowered SQL statement ready for a driver to execute: SQL text plus
 * driver-ready (codec-encoded) parameter values. The output of the control
 * adapter's `lowerToExecuteRequest`, handed to a driver via `SqlQueryable.query`
 * or `execute`. Inline-substituted positions (e.g. DDL `DEFAULT`
 * clauses) carry no param; `params` holds the wire values for the `$N`/`?`
 * positions, in order.
 */
export interface SqlExecuteRequest {
  readonly sql: string;
  readonly params?: readonly unknown[];
}

export interface PreparedExecuteRequest {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly handle: {
    get(): unknown;
    set(value: unknown): void;
  };
}

export interface SqlQueryResult<Row = Record<string, unknown>> {
  readonly rows: ReadonlyArray<Row>;
  readonly rowCount?: number | null;
  readonly [key: string]: unknown;
}

export interface SqlExplainResult<Row = Record<string, unknown>> {
  readonly rows: ReadonlyArray<Row>;
}

export type SqlDriverState = 'unbound' | 'connected' | 'closed';

export interface SqlDriver<TBinding = void> extends SqlQueryable {
  readonly state?: SqlDriverState;
  connect(binding: TBinding): Promise<void>;
  acquireConnection(): Promise<SqlConnection>;
  close(): Promise<void>;
}

export interface SqlConnection extends SqlQueryable {
  beginTransaction(): Promise<SqlTransaction>;
  /**
   * Returns the connection to the pool for reuse. Must only be called when the
   * connection is known to be in a clean, reusable state. If a transaction
   * operation (commit/rollback) failed or the connection is otherwise suspect,
   * call `destroy(reason)` instead.
   */
  release(): Promise<void>;
  /**
   * Evicts the connection so it is never reused. Call this when the
   * connection may be in an indeterminate state (e.g. a failed rollback
   * leaving an open transaction, or a broken socket).
   *
   * Implementations MUST:
   * - Leave the connection retryable if teardown fails, so a follow-up
   *   call can actually dispose of the handle. Calling destroy() or
   *   release() more than once after a successful teardown is caller
   *   error and behaves as the underlying primitive dictates (typically
   *   a thrown error).
   * - Treat `reason` as advisory context only. It may be surfaced to
   *   driver-level observability hooks (e.g. pg-pool's `'release'` event)
   *   but MUST NOT influence eviction behavior and MUST NOT be rethrown.
   * - Dispose of any driver-wide state that depends on this single
   *   connection (e.g. a direct-client driver should close itself, since a
   *   destroyed connection means its one underlying socket is unusable).
   * - Propagate errors raised while tearing down the underlying connection.
   *   The caller has context the driver does not (whether it is already
   *   about to throw a more informative error, whether it is shutting
   *   down, etc.) and is better positioned to decide whether to swallow
   *   or surface the failure.
   */
  destroy(reason?: unknown): Promise<void>;
}

export interface SqlTransaction extends SqlQueryable {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface SqlQueryable {
  execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row>;
  executePrepared<Row = Record<string, unknown>>(
    request: PreparedExecuteRequest,
  ): AsyncIterable<Row>;
  explain?(request: SqlExecuteRequest): Promise<SqlExplainResult>;
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
}
