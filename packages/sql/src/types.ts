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
import type { SqlContract, SqlStorage, StorageColumn } from './contract-types';
import type { Adapter } from '@prisma-next/sql-target';

export type Direction = 'asc' | 'desc';

export interface ParamPlaceholder {
  readonly kind: 'param-placeholder';
  readonly name: string;
}

export interface OrderBuilder<
  ColumnName extends string = string,
  ColumnMeta extends StorageColumn = StorageColumn,
> {
  readonly kind: 'order';
  readonly expr: ColumnBuilder<ColumnName, ColumnMeta>;
  readonly dir: Direction;
}

export interface ColumnBuilder<
  ColumnName extends string = string,
  ColumnMeta extends StorageColumn = StorageColumn,
> {
  readonly kind: 'column';
  readonly table: string;
  readonly column: ColumnName;
  readonly columnMeta: ColumnMeta;
  eq(value: ParamPlaceholder): BinaryBuilder<ColumnName, ColumnMeta>;
  asc(): OrderBuilder<ColumnName, ColumnMeta>;
  desc(): OrderBuilder<ColumnName, ColumnMeta>;
}

export interface BinaryBuilder<
  ColumnName extends string = string,
  ColumnMeta extends StorageColumn = StorageColumn,
> {
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
   * Optional mapping of projection alias → contract scalar type ID.
   * Used for codec resolution when AST+refs don't provide enough type info.
   */
  readonly projectionTypes?: Record<string, string>;
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
 * Maps codec output type string literal to JavaScript type.
 * Maps TypeScript type string literals (e.g., 'string', 'number') to actual TypeScript types.
 */
export type CodecOutputToJsType<T extends string> = T extends 'string'
  ? string
  : T extends 'number'
    ? number
    : T extends 'boolean'
      ? boolean
      : T extends 'bigint'
        ? bigint
        : T extends 'Date'
          ? Date
          : unknown;

/**
 * Helper type to extract codec output type from contract mappings.
 */
type ExtractCodecOutputType<
  CodecId extends string,
  CodecTypes extends Record<string, { output: string }>,
> = CodecId extends keyof CodecTypes
  ? CodecTypes[CodecId] extends { output: infer Output }
    ? Output extends string
      ? Output
      : never
    : never
  : never;

/**
 * Helper type to extract typeId from extension decorations for a column.
 * Searches through all extensions for a decoration matching the table/column.
 */
type GetColumnTypeId<
  TableName extends string,
  ColumnName extends string,
  Extensions extends Record<string, unknown> | undefined,
> = Extensions extends Record<string, unknown>
  ? {
      [K in keyof Extensions]: Extensions[K] extends {
        decorations?: {
          columns?: Array<{
            ref?: { kind?: string; table?: string; column?: string };
            payload?: { typeId?: string };
          }>;
        };
      }
        ? Extensions[K]['decorations'] extends {
            columns?: Array<infer D>;
          }
          ? D extends {
              ref?: { kind?: string; table?: infer T; column?: infer C };
              payload?: { typeId?: infer TId };
            }
              ? T extends TableName
                ? C extends ColumnName
                  ? TId extends string
                    ? TId
                    : never
                  : never
                : never
              : never
          : never
        : never;
    }[keyof Extensions]
  : never;

/**
 * Infers JavaScript type from a ColumnBuilder.
 *
 * Type inference rules:
 * 1. If column has a typeId in extension decorations, look up CodecTypes[typeId].output
 * 2. Otherwise, map storage scalar → JS type per target family
 * 3. Nullability propagates from storage column metadata
 *
 * Note: CodecTypes should be imported from contract.d.ts and passed as a type parameter.
 * If not provided, falls back to scalar mapping.
 */
export type InferColumnType<
  C extends ColumnBuilder,
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: string }> = Record<string, { output: string }>,
> = C extends ColumnBuilder & {
  table: infer TableName;
  column: infer ColumnName;
  columnMeta: { type: infer T; nullable: infer N };
}
  ? TableName extends string
    ? ColumnName extends string
      ? GetColumnTypeId<
          TableName,
          ColumnName,
          TContract['extensions']
        > extends infer TypeId
        ? TypeId extends string
          ? ExtractCodecOutputType<TypeId, CodecTypes> extends infer CodecOutput
            ? CodecOutput extends string
              ? N extends true
                ? CodecOutputToJsType<CodecOutput> | null
                : CodecOutputToJsType<CodecOutput>
              : T extends string
                ? N extends true
                  ? ContractScalarToJsType<T> | null
                  : ContractScalarToJsType<T>
                : unknown
            : T extends string
              ? N extends true
                ? ContractScalarToJsType<T> | null
                : ContractScalarToJsType<T>
              : unknown
          : T extends string
            ? N extends true
              ? ContractScalarToJsType<T> | null
              : ContractScalarToJsType<T>
            : unknown
        : T extends string
          ? N extends true
            ? ContractScalarToJsType<T> | null
            : ContractScalarToJsType<T>
          : unknown
      : unknown
    : unknown
  : unknown;

/**
 * Infers Row type from a projection object.
 * Maps Record<string, ColumnBuilder> to Record<string, JSType>
 */
export type InferProjectionRow<
  P extends Record<string, ColumnBuilder>,
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: string }> = Record<string, { output: string }>,
> = {
  [K in keyof P]: InferColumnType<P[K], TContract, CodecTypes>;
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
> {
  readonly contract: TContract;
  readonly adapter: Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>;
}
