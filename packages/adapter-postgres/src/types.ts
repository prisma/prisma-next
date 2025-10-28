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

export interface PostgresAdapterOptions {
  readonly profileId?: string;
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
  readonly left: ColumnRef;
  readonly right: ParamRef;
}

export type Direction = 'asc' | 'desc';

export interface OrderClause {
  readonly expr: ColumnRef;
  readonly dir: Direction;
}

export interface SelectAst {
  readonly kind: 'select';
  readonly from: { readonly kind: 'table'; readonly name: string };
  readonly project: ReadonlyArray<{ readonly alias: string; readonly expr: ColumnRef }>;
  readonly where?: BinaryExpr;
  readonly orderBy?: ReadonlyArray<OrderClause>;
  readonly limit?: number;
}

export interface PostgresLoweredStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly annotations?: Record<string, unknown>;
}
