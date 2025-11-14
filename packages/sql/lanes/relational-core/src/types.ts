import type { Plan, PlanRefs } from '@prisma-next/contract/types';
import type { ArgSpec, ReturnSpec } from '@prisma-next/operations';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type { SqlLoweringSpec } from '@prisma-next/sql-operations';
import type { ColumnRef, Direction, OperationExpr, ParamRef, QueryAst } from './ast/types';
import type { QueryLaneContext } from './query-lane-context';

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
  readonly expr: ColumnBuilder<ColumnName, ColumnMeta, JsType> | OperationExpr;
  readonly dir: Direction;
}

/**
 * ColumnBuilder with optional operation methods based on the column's typeId.
 * When Operations is provided and the column's typeId matches, operation methods are included.
 */
export type ColumnBuilder<
  ColumnName extends string = string,
  ColumnMeta extends StorageColumn = StorageColumn,
  JsType = unknown,
  Operations extends OperationTypes = Record<string, never>,
> = {
  readonly kind: 'column';
  readonly table: string;
  readonly column: ColumnName;
  readonly columnMeta: ColumnMeta;
  eq(value: ParamPlaceholder): BinaryBuilder<ColumnName, ColumnMeta, JsType>;
  asc(): OrderBuilder<ColumnName, ColumnMeta, JsType>;
  desc(): OrderBuilder<ColumnName, ColumnMeta, JsType>;
  // Helper property for type extraction (not used at runtime)
  readonly __jsType: JsType;
} & (ColumnMeta['type'] extends keyof Operations
  ? OperationMethods<
      OperationsForTypeId<ColumnMeta['type'], Operations>,
      ColumnName,
      StorageColumn,
      JsType
    >
  : Record<string, never>);

export interface BinaryBuilder<
  ColumnName extends string = string,
  ColumnMeta extends StorageColumn = StorageColumn,
  JsType = unknown,
> {
  readonly kind: 'binary';
  readonly op: 'eq';
  readonly left: ColumnBuilder<ColumnName, ColumnMeta, JsType> | OperationExpr;
  readonly right: ParamPlaceholder;
}

// Helper aliases for usage sites where the specific column parameters are irrelevant
// Accepts any ColumnBuilder regardless of its Operations parameter
// Note: We use `any` here because TypeScript's variance rules don't allow us to express
// "any type that extends OperationTypes" in a way that works for assignment.
// Contract-specific OperationTypes (e.g., PgVectorOperationTypes) are not assignable
// to the base OperationTypes in generic parameter position, even though they extend it structurally.
// biome-ignore lint/suspicious/noExplicitAny: AnyColumnBuilder must accept column builders with any operation types
export type AnyColumnBuilder = ColumnBuilder<string, StorageColumn, unknown, any>;
export type AnyBinaryBuilder = BinaryBuilder<string, StorageColumn, unknown>;
export type AnyOrderBuilder = OrderBuilder<string, StorageColumn, unknown>;

export function isColumnBuilder(value: unknown): value is AnyColumnBuilder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'column'
  );
}

export interface JoinOnBuilder {
  eqCol(left: AnyColumnBuilder, right: AnyColumnBuilder): JoinOnPredicate;
}

export interface JoinOnPredicate {
  readonly kind: 'join-on';
  readonly left: AnyColumnBuilder;
  readonly right: AnyColumnBuilder;
}

export type Expr = ColumnRef | ParamRef;

/**
 * Helper type to extract codec output type from CodecTypes.
 * Returns never if the codecId is not found in CodecTypes.
 */
type ExtractCodecOutputType<
  CodecId extends string,
  CodecTypes extends Record<string, { readonly output: unknown }>,
> = CodecId extends keyof CodecTypes
  ? CodecTypes[CodecId] extends { readonly output: infer Output }
    ? Output
    : never
  : never;

/**
 * Type-level operation signature.
 * Represents an operation at the type level, similar to OperationSignature at runtime.
 */
export type OperationTypeSignature = {
  readonly args: ReadonlyArray<ArgSpec>;
  readonly returns: ReturnSpec;
  readonly lowering: SqlLoweringSpec;
  readonly capabilities?: ReadonlyArray<string>;
};

/**
 * Type-level operation registry.
 * Maps typeId → operations, where operations is a record of method name → operation signature.
 *
 * Example:
 * ```typescript
 * type MyOperations: OperationTypes = {
 *   'pgvector/vector@1': {
 *     cosineDistance: {
 *       args: [{ kind: 'typeId'; type: 'pgvector/vector@1' }];
 *       returns: { kind: 'builtin'; type: 'number' };
 *       lowering: { targetFamily: 'sql'; strategy: 'function'; template: '...' };
 *     };
 *   };
 * };
 * ```
 */
export type OperationTypes = Record<string, Record<string, OperationTypeSignature>>;

/**
 * CodecTypes represents a map of typeId to codec definitions.
 * Each codec definition must have an `output` property indicating the JavaScript type.
 *
 * Example:
 * ```typescript
 * type MyCodecTypes: CodecTypes = {
 *   'pg/int4@1': { output: number };
 *   'pg/text@1': { output: string };
 * };
 * ```
 */
export type CodecTypes = Record<string, { readonly output: unknown }>;

/**
 * Extracts operations for a given typeId from the operation registry.
 * Returns an empty record if the typeId is not found.
 *
 * @example
 * ```typescript
 * type Ops = OperationsForTypeId<'pgvector/vector@1', MyOperations>;
 * // Ops = { cosineDistance: { ... }, l2Distance: { ... } }
 * ```
 */
export type OperationsForTypeId<
  TypeId extends string,
  Operations extends OperationTypes,
> = Operations extends Record<string, never>
  ? Record<string, never>
  : TypeId extends keyof Operations
    ? Operations[TypeId]
    : Record<string, never>;

/**
 * Maps operation signatures to method signatures on ColumnBuilder.
 * Each operation becomes a method that returns a ColumnBuilder or BinaryBuilder
 * based on the return type.
 */
type OperationMethods<
  Ops extends Record<string, OperationTypeSignature>,
  ColumnName extends string,
  ColumnMeta extends StorageColumn,
  JsType,
> = {
  [K in keyof Ops]: Ops[K] extends OperationTypeSignature
    ? (
        ...args: OperationArgs<Ops[K]['args']>
      ) => OperationReturn<Ops[K]['returns'], ColumnName, ColumnMeta, JsType>
    : never;
};

/**
 * Maps operation argument specs to TypeScript argument types.
 * - typeId args: ColumnBuilder (accepts base columns or operation results)
 * - param args: ParamPlaceholder
 * - literal args: unknown (could be more specific in future)
 */
type OperationArgs<Args extends ReadonlyArray<ArgSpec>> = Args extends readonly [
  infer First,
  ...infer Rest,
]
  ? First extends ArgSpec
    ? [ArgToType<First>, ...(Rest extends ReadonlyArray<ArgSpec> ? OperationArgs<Rest> : [])]
    : []
  : [];

type ArgToType<Arg extends ArgSpec> = Arg extends { kind: 'typeId' }
  ? AnyColumnBuilder
  : Arg extends { kind: 'param' }
    ? ParamPlaceholder
    : Arg extends { kind: 'literal' }
      ? unknown
      : never;

/**
 * Maps operation return spec to return type.
 * - builtin types: ColumnBuilder with appropriate JsType (matches runtime behavior)
 * - typeId types: ColumnBuilder (for now, could be more specific in future)
 */
type OperationReturn<
  Returns extends ReturnSpec,
  ColumnName extends string,
  ColumnMeta extends StorageColumn,
  _JsType,
> = Returns extends { kind: 'builtin'; type: infer T }
  ? T extends 'number'
    ? ColumnBuilder<ColumnName, ColumnMeta, number>
    : T extends 'boolean'
      ? ColumnBuilder<ColumnName, ColumnMeta, boolean>
      : T extends 'string'
        ? ColumnBuilder<ColumnName, ColumnMeta, string>
        : ColumnBuilder<ColumnName, ColumnMeta, unknown>
  : Returns extends { kind: 'typeId' }
    ? AnyColumnBuilder
    : ColumnBuilder<ColumnName, ColumnMeta, unknown>;

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
  CodecTypes extends Record<string, { readonly output: unknown }>,
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
/**
 * Extracts the inferred JsType carried by a ColumnBuilder.
 */
type ExtractJsTypeFromColumnBuilder<CB extends AnyColumnBuilder> = CB extends ColumnBuilder<
  infer _ColumnName extends string,
  infer _ColumnMeta extends StorageColumn,
  infer JsType,
  infer _Ops
>
  ? JsType
  : never;

export type InferProjectionRow<P extends Record<string, AnyColumnBuilder>> = {
  [K in keyof P]: ExtractJsTypeFromColumnBuilder<P[K]>;
};

/**
 * Nested projection type - allows recursive nesting of ColumnBuilder or nested objects.
 */
export type NestedProjection = Record<
  string,
  | AnyColumnBuilder
  | Record<
      string,
      | AnyColumnBuilder
      | Record<
          string,
          AnyColumnBuilder | Record<string, AnyColumnBuilder | Record<string, AnyColumnBuilder>>
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
  P extends Record<string, AnyColumnBuilder | boolean | NestedProjection>,
  CodecTypes extends Record<string, { readonly output: unknown }> = Record<string, never>,
  Includes extends Record<string, unknown> = Record<string, never>,
> = {
  [K in keyof P]: P[K] extends AnyColumnBuilder
    ? ExtractJsTypeFromColumnBuilder<P[K]>
    : P[K] extends true
      ? Array<ExtractIncludeType<K & string, Includes>> // Include reference - infers Array<ChildShape> from Includes map
      : P[K] extends NestedProjection
        ? InferNestedProjectionRow<P[K], CodecTypes, Includes>
        : never;
};

/**
 * Infers Row type from a tuple of ColumnBuilders used in returning() clause.
 * Extracts column name and JsType from each ColumnBuilder and creates a Record.
 */
export type InferReturningRow<Columns extends readonly AnyColumnBuilder[]> =
  Columns extends readonly [infer First, ...infer Rest]
    ? First extends ColumnBuilder<
        infer Name,
        infer _Meta,
        infer JsType,
        infer _Ops extends OperationTypes
      >
      ? Name extends string
        ? Rest extends readonly AnyColumnBuilder[]
          ? { [K in Name]: JsType } & InferReturningRow<Rest>
          : { [K in Name]: JsType }
        : never
      : never
    : Record<string, never>;

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

/**
 * SQL-specific Plan type that refines the ast field to use QueryAst.
 * This is the type used by SQL query builders.
 */
export type SqlPlan<Row = unknown> = Omit<Plan<Row>, 'ast'> & {
  readonly ast?: QueryAst;
};

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

export type { RuntimeError } from '@prisma-next/plan';

export interface BuildParamsMap {
  readonly [name: string]: unknown;
}

export interface BuildOptions {
  readonly params?: BuildParamsMap;
}

export interface SqlBuilderOptions<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
> {
  readonly context: QueryLaneContext<TContract>;
}
