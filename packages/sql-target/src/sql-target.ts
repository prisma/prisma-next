import type { CodecRegistry } from './codecs';

export type AdapterTarget = string;

export interface AdapterProfile<TTarget extends AdapterTarget = AdapterTarget> {
  readonly id: string;
  readonly target: TTarget;
  readonly capabilities: Record<string, unknown>;
  /**
   * Returns the adapter's default codec registry.
   * The registry contains codecs provided by the adapter for converting
   * between wire types and JavaScript types.
   */
  codecs(): CodecRegistry;
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

// SQL-specific AST types and supporting types
// These types are needed by adapters and runtime for SQL query execution

export type Direction = 'asc' | 'desc';

export interface TableRef {
  readonly kind: 'table';
  readonly name: string;
}

export interface ColumnRef {
  readonly kind: 'col';
  readonly table: string;
  readonly column: string;
}

export interface ParamRef {
  readonly kind: 'param';
  readonly index: number;
  readonly name?: string;
}

export interface LiteralExpr {
  readonly kind: 'literal';
  readonly value: unknown;
}

export interface OperationExpr {
  readonly kind: 'operation';
  readonly method: string;
  readonly forTypeId: string;
  readonly self: ColumnRef;
  readonly args: ReadonlyArray<ColumnRef | ParamRef | LiteralExpr>;
  readonly returns: import('./operations-registry').ReturnSpec;
  readonly lowering: import('./operations-registry').LoweringSpec;
}

export interface BinaryExpr {
  readonly kind: 'bin';
  readonly op: 'eq';
  readonly left: ColumnRef | OperationExpr;
  readonly right: ParamRef;
}

export interface ExistsExpr {
  readonly kind: 'exists';
  readonly not: boolean;
  readonly subquery: SelectAst;
}

export type JoinOnExpr = {
  readonly kind: 'eqCol';
  readonly left: ColumnRef;
  readonly right: ColumnRef;
};

export interface JoinAst {
  readonly kind: 'join';
  readonly joinType: 'inner' | 'left' | 'right' | 'full';
  readonly table: TableRef;
  readonly on: JoinOnExpr;
}

export interface IncludeRef {
  readonly kind: 'includeRef';
  readonly alias: string;
}

export interface IncludeAst {
  readonly kind: 'includeMany';
  readonly alias: string;
  readonly child: {
    readonly table: TableRef;
    readonly on: JoinOnExpr;
    readonly where?: BinaryExpr | ExistsExpr;
    readonly orderBy?: ReadonlyArray<{ expr: ColumnRef | OperationExpr; dir: Direction }>;
    readonly limit?: number;
    readonly project: ReadonlyArray<{ alias: string; expr: ColumnRef | OperationExpr }>;
  };
}

export interface SelectAst {
  readonly kind: 'select';
  readonly from: TableRef;
  readonly joins?: ReadonlyArray<JoinAst>;
  readonly includes?: ReadonlyArray<IncludeAst>;
  readonly project: ReadonlyArray<{
    alias: string;
    expr: ColumnRef | IncludeRef | OperationExpr;
  }>;
  readonly where?: BinaryExpr | ExistsExpr;
  readonly orderBy?: ReadonlyArray<{ expr: ColumnRef | OperationExpr; dir: Direction }>;
  readonly limit?: number;
}

export interface InsertAst {
  readonly kind: 'insert';
  readonly table: TableRef;
  readonly values: Record<string, ColumnRef | ParamRef>;
  readonly returning?: ReadonlyArray<ColumnRef>;
}

export interface UpdateAst {
  readonly kind: 'update';
  readonly table: TableRef;
  readonly set: Record<string, ColumnRef | ParamRef>;
  readonly where: BinaryExpr;
  readonly returning?: ReadonlyArray<ColumnRef>;
}

export interface DeleteAst {
  readonly kind: 'delete';
  readonly table: TableRef;
  readonly where: BinaryExpr;
  readonly returning?: ReadonlyArray<ColumnRef>;
}

export type QueryAst = SelectAst | InsertAst | UpdateAst | DeleteAst;

export interface LoweredStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly annotations?: Record<string, unknown>;
}
