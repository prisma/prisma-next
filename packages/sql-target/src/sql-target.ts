export type AdapterTarget = string;

export interface AdapterProfile<TTarget extends AdapterTarget = AdapterTarget> {
  readonly id: string;
  readonly target: TTarget;
  readonly capabilities: Record<string, unknown>;
}

export interface LoweredPayload<TBody = unknown> {
  readonly profileId?: string;
  readonly body: TBody;
  readonly annotations?: Record<string, unknown>;
}

export interface LowererContext<TContract = unknown> {
  readonly contract: TContract;
  readonly params?: readonly unknown[];
}

export type Lowerer<Ast = unknown, TContract = unknown, TBody = unknown> = (
  ast: Ast,
  context: LowererContext<TContract>,
) => LoweredPayload<TBody>;

export interface Adapter<Ast = unknown, TContract = unknown, TBody = unknown> {
  readonly profile: AdapterProfile;
  lower(ast: Ast, context: LowererContext<TContract>): LoweredPayload<TBody>;
}

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
