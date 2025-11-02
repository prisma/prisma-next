export type {
  Adapter,
  AdapterProfile,
  AdapterTarget,
  LoweredPayload,
  Lowerer,
  LowererContext,
  SqlDriver,
  SqlExecuteRequest,
  SqlExplainResult,
  SqlQueryResult,
} from '@prisma-next/sql-target';
import type { SqlContract, StorageColumn } from '@prisma-next/contract/types';
import type { Adapter } from '@prisma-next/sql-target';

export type Direction = 'asc' | 'desc';

export interface ParamPlaceholder {
  readonly kind: 'param-placeholder';
  readonly name: string;
}

export interface OrderBuilder<ColumnName extends string = string, ColumnMeta extends StorageColumn = StorageColumn> {
  readonly kind: 'order';
  readonly expr: ColumnBuilder<ColumnName, ColumnMeta>;
  readonly dir: Direction;
}

export interface ColumnBuilder<ColumnName extends string = string, ColumnMeta extends StorageColumn = StorageColumn> {
  readonly kind: 'column';
  readonly table: string;
  readonly column: ColumnName;
  readonly columnMeta: ColumnMeta;
  eq(value: ParamPlaceholder): BinaryBuilder<ColumnName, ColumnMeta>;
  asc(): OrderBuilder<ColumnName, ColumnMeta>;
  desc(): OrderBuilder<ColumnName, ColumnMeta>;
}

export interface BinaryBuilder<ColumnName extends string = string, ColumnMeta extends StorageColumn = StorageColumn> {
  readonly kind: 'binary';
  readonly op: 'eq';
  readonly left: ColumnBuilder<ColumnName, ColumnMeta>;
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
  readonly left: ColumnRef;
  readonly right: ParamRef;
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
  readonly index?: number;
  readonly name?: string;
  readonly type?: string;
  readonly nullable?: boolean;
  readonly source: 'dsl' | 'raw';
  readonly refs?: { table: string; column: string };
}

export interface PlanRefs {
  readonly tables: readonly string[];
  readonly columns: ReadonlyArray<{ table: string; column: string }>;
}

export interface PlanMetaBase {
  readonly target: string;
  readonly targetFamily?: string;
  readonly coreHash: string;
  readonly profileHash?: string;
  readonly lane: 'dsl' | 'raw';
  readonly annotations?: {
    codecs?: Record<string, string>; // alias/param → codec id ('ns/name@v')
    [key: string]: unknown;
  };
  readonly paramDescriptors: ReadonlyArray<ParamDescriptor>;
}

export interface DslPlanMeta extends PlanMetaBase {
  readonly lane: 'dsl';
  readonly refs: PlanRefs;
  readonly projection: Record<string, string>;
  /**
   * Optional mapping of projection alias → contract scalar type ID.
   * Used for codec resolution when AST+refs don't provide enough type info.
   */
  readonly projectionTypes?: Record<string, string>;
}

export interface RawPlanRefs {
  readonly tables?: readonly string[];
  readonly columns?: ReadonlyArray<{ table: string; column: string }>;
  readonly indexes?: ReadonlyArray<{
    readonly table: string;
    readonly columns: ReadonlyArray<string>;
    readonly name?: string;
  }>;
}

export interface RawPlanMeta extends PlanMetaBase {
  readonly lane: 'raw';
  readonly target: 'postgres';
  readonly refs?: RawPlanRefs;
  readonly projection?: ReadonlyArray<string>;
}

export interface PlanBase<_Row = unknown, M extends PlanMetaBase = PlanMetaBase> {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly meta: M;
}

/**
 * Maps contract scalar type to JavaScript type.
 * MVP mapping: text→string, int4/float8→number, timestamptz→string
 */
export type ContractScalarToJsType<T extends string> = T extends 'text'
  ? string
  : T extends 'int4' | 'float8'
    ? number
    : T extends 'timestamptz' | 'timestamp'
      ? string
      : unknown;

/**
 * Infers JavaScript type from a ColumnBuilder based on its columnMeta.type.
 */
export type InferColumnType<C extends ColumnBuilder> = C extends ColumnBuilder & {
  columnMeta: { type: infer T; nullable: infer N };
}
  ? T extends string
    ? N extends true
      ? ContractScalarToJsType<T> | null
      : ContractScalarToJsType<T>
    : unknown
  : unknown;

/**
 * Infers Row type from a projection object.
 * Maps Record<string, ColumnBuilder> to Record<string, JSType>
 */
export type InferProjectionRow<P extends Record<string, ColumnBuilder>> = {
  [K in keyof P]: InferColumnType<P[K]>;
};

/**
 * Utility type to extract the Row type from a Plan.
 * Example: `type Row = ResultType<typeof plan>`
 */
export type ResultType<P> = P extends PlanBase<infer R> ? R : never;

/**
 * Helper types for extracting contract structure.
 */
export type TablesOf<TContract> = TContract extends { storage: { tables: infer U } }
  ? U
  : never;

export type TableKey<TContract> = Extract<keyof TablesOf<TContract>, string>;

export type ColumnsOf<TContract, K extends TableKey<TContract>> = K extends keyof TablesOf<TContract>
  ? TablesOf<TContract>[K] extends { columns: infer C }
    ? C
    : never
  : never;

export interface DslPlan<Row = unknown> extends PlanBase<Row, DslPlanMeta> {
  readonly ast: SelectAst;
}

export interface RawPlan<Row = unknown> extends PlanBase<Row, RawPlanMeta> {}

export type Plan<Row = unknown> = DslPlan<Row> | RawPlan<Row>;

export interface RawTemplateOptions {
  readonly refs?: RawPlanRefs;
  readonly annotations?: Record<string, unknown>;
  readonly projection?: ReadonlyArray<string>;
}

export interface RawFunctionOptions extends RawTemplateOptions {
  readonly params: ReadonlyArray<unknown>;
}

export interface RawTemplateFactory {
  (strings: TemplateStringsArray, ...values: readonly unknown[]): RawPlan;
}

export interface RawFactory extends RawTemplateFactory {
  (text: string, options: RawFunctionOptions): RawPlan;
  with(options: RawTemplateOptions): RawTemplateFactory;
}

export interface LoweredStatement {
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

export interface SqlBuilderOptions<TContract extends SqlContract = SqlContract> {
  readonly contract: TContract;
  readonly adapter: Adapter<SelectAst, SqlContract, LoweredStatement>;
}
