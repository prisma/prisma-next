export type {
  Adapter,
  AdapterProfile,
  AdapterTarget,
  LoweredPayload,
  Lowerer,
  LowererContext,
  ModelDefinition,
  ModelField,
  ModelStorage,
  SqlContract,
  SqlDriver,
  SqlExecuteRequest,
  SqlExplainResult,
  SqlMappings,
  SqlQueryResult,
  SqlStorage,
  StorageColumn,
  StorageTable,
} from '@prisma-next/sql-target';

import type {
  Adapter,
  ColumnRef,
  Direction,
  LoweredStatement,
  ParamRef,
  QueryAst,
  SqlContract,
  SqlStorage,
  StorageColumn,
} from '@prisma-next/sql-target';

import type { Plan, PlanRefs } from '@prisma-next/contract/types';

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

export type Expr = ColumnRef | ParamRef;

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
export type NestedProjection = Record<
  string,
  | ColumnBuilder
  | Record<
      string,
      | ColumnBuilder
      | Record<
          string,
          ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>
        >
    >
>;

/**
 * Helper type to extract include type from Includes map.
 * Returns the value type if K is a key of Includes, otherwise returns unknown.
 */
type ExtractIncludeType<
  K extends string,
  Includes extends Record<string, unknown>,
> = K extends keyof Includes ? Includes[K] : unknown;

/**
 * Infers Row type from a nested projection object.
 * Recursively maps Record<string, ColumnBuilder | boolean | NestedProjection> to nested object types.
 *
 * Extracts the pre-computed JsType from each ColumnBuilder at leaves.
 * When a value is `true`, it represents an include reference and infers `Array<ChildShape>`
 * by looking up the include alias in the Includes type map.
 */
export type InferNestedProjectionRow<
  P extends Record<
    string,
    | ColumnBuilder
    | boolean
    | Record<
        string,
        | ColumnBuilder
        | Record<
            string,
            ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>
          >
      >
  >,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
  Includes extends Record<string, unknown> = Record<string, never>,
> = {
  [K in keyof P]: P[K] extends ColumnBuilder<infer _Name, infer _Meta, infer JsType>
    ? JsType
    : P[K] extends true
      ? Array<ExtractIncludeType<K & string, Includes>> // Include reference - infers Array<ChildShape> from Includes map
      : P[K] extends Record<
            string,
            | ColumnBuilder
            | Record<
                string,
                | ColumnBuilder
                | Record<
                    string,
                    ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>
                  >
              >
          >
        ? InferNestedProjectionRow<P[K], CodecTypes, Includes>
        : never;
};

/**
 * Infers Row type from a tuple of ColumnBuilders used in returning() clause.
 * Extracts column name and JsType from each ColumnBuilder and creates a Record.
 */
export type InferReturningRow<Columns extends readonly ColumnBuilder[]> = Columns extends readonly [
  infer First,
  ...infer Rest,
]
  ? First extends ColumnBuilder<infer Name, infer _Meta, infer JsType>
    ? Name extends string
      ? Rest extends readonly ColumnBuilder[]
        ? { [K in Name]: JsType } & InferReturningRow<Rest>
        : { [K in Name]: JsType }
      : never
    : never
  : {};

/**
 * Utility type to check if a contract has the required capabilities for includeMany.
 * Requires both `lateral` and `jsonAgg` to be `true` in the contract's capabilities for the target.
 * Capabilities are nested by target: `{ [target]: { lateral: true, jsonAgg: true } }`
 */
export type HasIncludeManyCapabilities<TContract extends SqlContract<SqlStorage>> =
  TContract extends { capabilities: infer C; target: infer T }
    ? T extends string
      ? C extends Record<string, Record<string, boolean>>
        ? C extends { [K in T]: infer TargetCaps }
          ? TargetCaps extends { lateral: true; jsonAgg: true }
            ? true
            : false
          : false
        : false
      : false
    : false;

// Re-export Plan types from contract for backward compatibility
export type { ParamDescriptor, PlanMeta, PlanRefs, ResultType } from '@prisma-next/contract/types';

// Re-export AST types from sql-target for backward compatibility
export type {
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  Direction,
  IncludeAst,
  IncludeRef,
  InsertAst,
  JoinAst,
  JoinOnExpr,
  LoweredStatement,
  ParamRef,
  QueryAst,
  SelectAst,
  TableRef,
  UpdateAst,
} from '@prisma-next/sql-target';

/**
 * SQL-specific Plan type that refines the ast field to use QueryAst.
 * This is the type used by SQL query builders.
 */
export type SqlPlan<Row = unknown> = Omit<Plan<Row>, 'ast'> & {
  readonly ast?: QueryAst;
};

// Re-export Plan as SqlPlan for backward compatibility
// Also export as Plan for compatibility with existing code
export type { Plan } from '@prisma-next/contract/types';

/**
 * Helper types for extracting contract structure.
 */
export type TablesOf<TContract> = TContract extends {
  storage: { tables: infer U };
}
  ? U
  : never;

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

export interface RawTemplateOptions {
  readonly refs?: PlanRefs;
  readonly annotations?: Record<string, unknown>;
  readonly projection?: ReadonlyArray<string>;
}

export interface RawFunctionOptions extends RawTemplateOptions {
  readonly params: ReadonlyArray<unknown>;
}

export type RawTemplateFactory = (
  strings: TemplateStringsArray,
  ...values: readonly unknown[]
) => Plan;

export interface RawFactory extends RawTemplateFactory {
  (text: string, options: RawFunctionOptions): Plan;
  with(options: RawTemplateOptions): RawTemplateFactory;
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
  readonly adapter: Adapter<QueryAst, SqlContract<SqlStorage>, LoweredStatement>;
  readonly codecTypes?: CodecTypes;
}
