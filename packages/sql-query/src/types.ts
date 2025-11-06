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
  SqlContract,
  SqlStorage,
  StorageColumn,
  SqlMappings,
  StorageTable,
  ModelDefinition,
  ModelField,
  ModelStorage,
} from '@prisma-next/sql-target';
import type { Adapter, SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-target';

export type Direction = 'asc' | 'desc';

export interface ParamPlaceholder {
  readonly kind: 'param-placeholder';
  readonly name: string;
}

export interface OrderBuilder<
  ColumnName extends string = string,
  ColumnMeta extends StorageColumn = StorageColumn,
  JsType = unknown,
> {
  readonly kind: 'order';
  readonly expr: ColumnBuilder<ColumnName, ColumnMeta, JsType>;
  readonly dir: Direction;
}

export interface ColumnBuilder<
  ColumnName extends string = string,
  ColumnMeta extends StorageColumn = StorageColumn,
  JsType = unknown,
> {
  readonly kind: 'column';
  readonly table: string;
  readonly column: ColumnName;
  readonly columnMeta: ColumnMeta;
  eq(value: ParamPlaceholder): BinaryBuilder<ColumnName, ColumnMeta, JsType>;
  asc(): OrderBuilder<ColumnName, ColumnMeta, JsType>;
  desc(): OrderBuilder<ColumnName, ColumnMeta, JsType>;
}

export interface BinaryBuilder<
  ColumnName extends string = string,
  ColumnMeta extends StorageColumn = StorageColumn,
  JsType = unknown,
> {
  readonly kind: 'binary';
  readonly op: 'eq';
  readonly left: ColumnBuilder<ColumnName, ColumnMeta, JsType>;
  readonly right: ParamPlaceholder;
}

export interface JoinOnBuilder {
  eqCol(
    left: ColumnBuilder<string, StorageColumn, unknown>,
    right: ColumnBuilder<string, StorageColumn, unknown>,
  ): JoinOnPredicate;
}

export interface JoinOnPredicate {
  readonly kind: 'join-on';
  readonly left: ColumnBuilder<string, StorageColumn, unknown>;
  readonly right: ColumnBuilder<string, StorageColumn, unknown>;
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

export interface SelectAst {
  readonly kind: 'select';
  readonly from: TableRef;
  readonly joins?: ReadonlyArray<JoinAst>;
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
  readonly tables?: readonly string[];
  readonly columns?: ReadonlyArray<{ table: string; column: string }>;
  readonly indexes?: ReadonlyArray<{
    readonly table: string;
    readonly columns: ReadonlyArray<string>;
    readonly name?: string;
  }>;
}

export interface PlanMeta {
  readonly target: string;
  readonly targetFamily?: string;
  readonly coreHash: string;
  readonly profileHash?: string;
  readonly lane: string;
  readonly annotations?: {
    codecs?: Record<string, string>; // alias/param → codec id ('ns/name@v')
    [key: string]: unknown;
  };
  readonly paramDescriptors: ReadonlyArray<ParamDescriptor>;
  readonly refs?: PlanRefs;
  readonly projection?: Record<string, string> | ReadonlyArray<string>;
  /**
   * Optional mapping of projection alias → column type ID (fully qualified ns/name@version).
   * Used for codec resolution when AST+refs don't provide enough type info.
   */
  readonly projectionTypes?: Record<string, string>;
}

/**
 * Helper type to extract codec output type from CodecTypes.
 * Returns never if the codecId is not found in CodecTypes.
 */
type ExtractCodecOutputType<
  CodecId extends string,
  CodecTypes extends Record<string, { output: unknown }>,
> = CodecId extends keyof CodecTypes
  ? CodecTypes[CodecId] extends { output: infer Output }
    ? Output
    : never
  : never;

/**
 * Computes JavaScript type for a column at column creation time.
 *
 * Type inference:
 * - Read columnMeta.type as typeId string literal
 * - Look up CodecTypes[typeId].output
 * - Apply nullability: nullable ? Output | null : Output
 */
export type ComputeColumnJsType<
  _Contract extends SqlContract<SqlStorage>,
  _TableName extends string,
  _ColumnName extends string,
  ColumnMeta extends StorageColumn,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
> = ColumnMeta extends { type: infer T; nullable: infer N }
  ? T extends string
    ? ExtractCodecOutputType<T, CodecTypes> extends infer CodecOutput
      ? [CodecOutput] extends [never]
        ? unknown // Codec not found in CodecTypes
        : N extends true
          ? CodecOutput | null
          : CodecOutput
      : unknown
    : unknown
  : unknown;

/**
 * Infers Row type from a projection object.
 * Maps Record<string, ColumnBuilder> to Record<string, JSType>
 *
 * Extracts the pre-computed JsType from each ColumnBuilder in the projection.
 */
export type InferProjectionRow<P extends Record<string, ColumnBuilder>> = {
  [K in keyof P]: P[K] extends ColumnBuilder<infer _Name, infer _Meta, infer JsType>
    ? JsType
    : never;
};

/**
 * Nested projection type - allows recursive nesting of ColumnBuilder or nested objects.
 */
export type NestedProjection = Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>>>>;

/**
 * Infers Row type from a nested projection object.
 * Recursively maps Record<string, ColumnBuilder | NestedProjection> to nested object types.
 *
 * Extracts the pre-computed JsType from each ColumnBuilder at leaves.
 */
export type InferNestedProjectionRow<
  P extends Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>>>>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
> = {
  [K in keyof P]: P[K] extends ColumnBuilder<infer _Name, infer _Meta, infer JsType>
    ? JsType
    : P[K] extends Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>>>>
      ? InferNestedProjectionRow<P[K], CodecTypes>
      : never;
};

/**
 * Utility type to extract the Row type from a Plan.
 * Example: `type Row = ResultType<typeof plan>`
 */
export type ResultType<P> = P extends Plan<infer R> ? R : never;

/**
 * Helper types for extracting contract structure.
 */
export type TablesOf<TContract> = TContract extends { storage: { tables: infer U } } ? U : never;

export type TableKey<TContract> = Extract<keyof TablesOf<TContract>, string>;

// Common types for contract.d.ts generation (SQL-specific)
// These types are used by emitted contract.d.ts files to provide type-safe DSL/ORM types

/**
 * Unique symbol for metadata property to avoid collisions with user-defined properties
 */
export declare const META: unique symbol;

/**
 * Extracts metadata from a type that has a META property
 */
export type Meta<T extends { [META]: unknown }> = T[typeof META];

/**
 * Metadata interface for table definitions
 */
export interface TableMetadata<Name extends string> {
  name: Name;
}

/**
 * Metadata interface for model definitions
 */
export interface ModelMetadata<Name extends string> {
  name: Name;
}

/**
 * Base interface for table definitions with metadata
 * Used in contract.d.ts to define storage-level table types
 */
export interface TableDef<Name extends string> {
  readonly [META]: TableMetadata<Name>;
}

/**
 * Base interface for model definitions with metadata
 * Used in contract.d.ts to define application-level model types
 */
export interface ModelDef<Name extends string> {
  readonly [META]: ModelMetadata<Name>;
}

export type ColumnsOf<
  TContract,
  K extends TableKey<TContract>,
> = K extends keyof TablesOf<TContract>
  ? TablesOf<TContract>[K] extends { columns: infer C }
    ? C
    : never
  : never;

export interface Plan<_Row = unknown> {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly ast?: SelectAst;
  readonly meta: PlanMeta;
}

export interface RawTemplateOptions {
  readonly refs?: PlanRefs;
  readonly annotations?: Record<string, unknown>;
  readonly projection?: ReadonlyArray<string>;
}

export interface RawFunctionOptions extends RawTemplateOptions {
  readonly params: ReadonlyArray<unknown>;
}

export interface RawTemplateFactory {
  (strings: TemplateStringsArray, ...values: readonly unknown[]): Plan;
}

export interface RawFactory extends RawTemplateFactory {
  (text: string, options: RawFunctionOptions): Plan;
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

export interface SqlBuilderOptions<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
> {
  readonly contract: TContract;
  readonly adapter: Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>;
  readonly codecTypes?: CodecTypes;
}
