export interface SqlExecuteRequest {
  readonly sql: string;
  readonly params?: readonly unknown[];
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
  release(): Promise<void>;
}

export interface SqlTransaction extends SqlQueryable {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface SqlQueryable {
  execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row>;
  explain?(request: SqlExecuteRequest): Promise<SqlExplainResult>;
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
}
