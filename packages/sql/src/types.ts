export type Direction = 'asc' | 'desc';

export type AdapterTarget = string;

export interface AdapterProfile<TTarget extends AdapterTarget = AdapterTarget> {
  readonly id: string;
  readonly target: TTarget;
  readonly capabilities: Record<string, unknown>;
}

export interface LowererContext<TContract = unknown> {
  readonly contract: TContract;
  readonly params?: readonly unknown[];
}

export interface LoweredPayload<TBody = unknown> {
  readonly profileId?: string;
  readonly body: TBody;
  readonly annotations?: Record<string, unknown>;
}

export interface Adapter<Ast = unknown, TContract = unknown, TBody = unknown> {
  readonly profile: AdapterProfile;
  lower(ast: Ast, context: LowererContext<TContract>): LoweredPayload<TBody>;
}

export interface StorageColumn {
  readonly type?: string;
  readonly nullable?: boolean;
}

export interface StorageTable {
  readonly columns: Record<string, StorageColumn>;
}

export interface ContractStorage {
  readonly tables: Record<string, StorageTable>;
}

export interface PostgresContract {
  readonly target: 'postgres';
  readonly coreHash: string;
  readonly profileHash?: string;
  readonly storage: ContractStorage;
}

export interface ParamPlaceholder {
  readonly kind: 'param-placeholder';
  readonly name: string;
}

export interface OrderBuilder {
  readonly kind: 'order';
  readonly expr: ColumnBuilder;
  readonly dir: Direction;
}

export interface ColumnBuilder {
  readonly kind: 'column';
  readonly table: string;
  readonly column: string;
  readonly columnMeta?: StorageColumn;
  eq(value: ParamPlaceholder): BinaryBuilder;
  asc(): OrderBuilder;
  desc(): OrderBuilder;
}

export interface BinaryBuilder {
  readonly kind: 'binary';
  readonly op: 'eq';
  readonly left: ColumnBuilder;
  readonly right: ParamPlaceholder;
}

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

export type Expr = ColumnRef | ParamRef;

export interface BinaryExpr {
  readonly kind: 'bin';
  readonly op: 'eq';
  readonly left: Expr;
  readonly right: Expr;
}

export interface SelectAst {
  readonly kind: 'select';
  readonly from: TableRef;
  readonly project: ReadonlyArray<{ alias: string; expr: ColumnRef }>;
  readonly where?: BinaryExpr;
  readonly orderBy?: ReadonlyArray<{ expr: ColumnRef; dir: Direction }>;
  readonly limit?: number;
}

export interface ParamDescriptor {
  readonly name?: string;
  readonly type?: string;
  readonly nullable?: boolean;
  readonly source: 'dsl' | 'raw';
  readonly refs?: { table: string; column: string };
}

export interface PlanMeta {
  readonly target: 'postgres';
  readonly coreHash: string;
  readonly profileHash?: string;
  readonly lane: 'dsl';
  readonly refs: {
    readonly tables: string[];
    readonly columns: Array<{ table: string; column: string }>;
  };
  readonly projection: Record<string, string>;
  readonly annotations?: Record<string, unknown>;
  readonly paramDescriptors: ParamDescriptor[];
}

export interface Plan {
  readonly ast: SelectAst;
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly meta: PlanMeta;
}

export interface PostgresLoweredStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly annotations?: Record<string, unknown>;
}

export interface RuntimeError extends Error {
  readonly code: string;
  readonly category: 'PLAN';
  readonly severity: 'error';
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly hints?: readonly string[];
  readonly docs?: readonly string[];
}

export interface BuildParamsMap {
  readonly [name: string]: unknown;
}

export interface BuildOptions {
  readonly params?: BuildParamsMap;
}

export interface SqlBuilderOptions {
  readonly contract: PostgresContract;
  readonly adapter: Adapter<SelectAst, PostgresContract, PostgresLoweredStatement>;
}
