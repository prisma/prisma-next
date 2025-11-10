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

export interface SqlDriver {
  connect(): Promise<void>;
  execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row>;
  explain?(request: SqlExecuteRequest): Promise<SqlExplainResult>;
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
  close(): Promise<void>;
}
