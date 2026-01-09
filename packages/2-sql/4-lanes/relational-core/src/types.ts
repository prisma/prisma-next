import type {
  ResultType as CoreResultType,
  ExecutionPlan,
  PlanRefs,
} from '@prisma-next/contract/types';
import type { ArgSpec, ReturnSpec } from '@prisma-next/operations';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type { SqlLoweringSpec } from '@prisma-next/sql-operations';
import type {
  BinaryOp,
  ColumnRef,
  Direction,
  Expression,
  ExpressionSource,
  OperationExpr,
  ParamRef,
  QueryAst,
} from './ast/types';
import type { SqlQueryPlan } from './plan';
import type { QueryLaneContext } from './query-lane-context';

export interface ParamPlaceholder {
  readonly kind: 'param-placeholder';
  readonly name: string;
}

/**
 * ValueSource represents any value that can appear in a comparison or as an argument.
 * This includes:
 * - ParamPlaceholder: A parameter placeholder (e.g., `param('userId')`)
 * - ExpressionSource: Something that can be converted to an Expression (ColumnBuilder, ExpressionBuilder)
 */
export type ValueSource = ParamPlaceholder | ExpressionSource;

export interface OrderBuilder<
  _ColumnName extends string = string,
  _ColumnMeta extends StorageColumn = StorageColumn,
  _JsType = unknown,
> {
  readonly kind: 'order';
  readonly expr: Expression;
  readonly dir: Direction;
}

/**
 * Creates an OrderBuilder for use in orderBy clauses.
 */
export function createOrderBuilder(
  expr: AnyColumnBuilder | OperationExpr,
  dir: Direction,
): AnyOrderBuilder {
  return { kind: 'order', expr, dir } as AnyOrderBuilder;
}

/**
 * ColumnBuilder with optional operation methods based on the column's typeId.
 * When Operations is provided and the column's typeId matches, operation methods are included.
 * Implements ExpressionSource to provide type-safe conversion to ColumnRef.
 *
 * For nullable columns (ColumnMeta['nullable'] extends true), includes isNull() and isNotNull() methods.
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
  // Methods accept ValueSource (ParamPlaceholder or ExpressionSource)
  eq(value: ValueSource): BinaryBuilder<ColumnName, ColumnMeta, JsType>;
  neq(value: ValueSource): BinaryBuilder<ColumnName, ColumnMeta, JsType>;
  gt(value: ValueSource): BinaryBuilder<ColumnName, ColumnMeta, JsType>;
  lt(value: ValueSource): BinaryBuilder<ColumnName, ColumnMeta, JsType>;
  gte(value: ValueSource): BinaryBuilder<ColumnName, ColumnMeta, JsType>;
  lte(value: ValueSource): BinaryBuilder<ColumnName, ColumnMeta, JsType>;
  asc(): OrderBuilder<ColumnName, ColumnMeta, JsType>;
  desc(): OrderBuilder<ColumnName, ColumnMeta, JsType>;
  /** Converts this column builder to a ColumnRef expression */
  toExpr(): ColumnRef;
  // Helper property for type extraction (not used at runtime)
  readonly __jsType: JsType;
} & (ColumnMeta['codecId'] extends string
  ? ColumnMeta['codecId'] extends keyof Operations
    ? OperationMethods<
        OperationsForTypeId<ColumnMeta['codecId'] & string, Operations>,
        ColumnName,
        StorageColumn,
        JsType
      >
    : Record<string, never>
  : Record<string, never>) &
  (ColumnMeta['nullable'] extends true
    ? NullableMethods<ColumnName, ColumnMeta, JsType>
    : Record<string, never>);

export interface BinaryBuilder<
  _ColumnName extends string = string,
  _ColumnMeta extends StorageColumn = StorageColumn,
  _JsType = unknown,
> {
  readonly kind: 'binary';
  readonly op: BinaryOp;
  readonly left: Expression;
  readonly right: ValueSource;
}

/**
 * Builder for IS NULL / IS NOT NULL checks.
 * Used to build unary null check expressions in WHERE clauses.
 */
export interface NullCheckBuilder<
  _ColumnName extends string = string,
  _ColumnMeta extends StorageColumn = StorageColumn,
  _JsType = unknown,
> {
  readonly kind: 'nullCheck';
  readonly expr: Expression;
  readonly isNull: boolean;
}

/**
 * Union type for unary builders (currently just NullCheckBuilder).
 * Extensible for future unary operators.
 */
export type UnaryBuilder = NullCheckBuilder;

// Forward declare AnyBinaryBuilder and AnyOrderBuilder for use in ExpressionBuilder
export type AnyBinaryBuilder = BinaryBuilder;
export type AnyOrderBuilder = OrderBuilder;
export type AnyUnaryBuilder = UnaryBuilder;

/**
 * Methods available only on nullable columns.
 * These are conditionally added to ColumnBuilder when ColumnMeta['nullable'] is true.
 * Note: Index signature is required for compatibility with AnyColumnBuilderBase's index signature.
 */
export interface NullableMethods<
  ColumnName extends string = string,
  ColumnMeta extends StorageColumn = StorageColumn,
  JsType = unknown,
> {
  /** Creates an IS NULL check for this column */
  isNull(): NullCheckBuilder<ColumnName, ColumnMeta, JsType>;
  /** Creates an IS NOT NULL check for this column */
  isNotNull(): NullCheckBuilder<ColumnName, ColumnMeta, JsType>;
  /** Index signature for compatibility with AnyColumnBuilderBase */
  readonly [key: string]: unknown;
}

/**
 * ExpressionBuilder represents the result of an operation (e.g., col.distance(...)).
 * Unlike ColumnBuilder (which represents a column), ExpressionBuilder represents
 * an operation expression and provides the same DSL methods for chaining.
 *
 * Implements ExpressionSource to provide type-safe conversion to OperationExpr.
 */
export interface ExpressionBuilder<JsType = unknown> extends ExpressionSource {
  readonly kind: 'expression';
  readonly expr: OperationExpr;
  readonly columnMeta: StorageColumn;

  // Methods accept ValueSource (ParamPlaceholder or ExpressionSource)
  eq(value: ValueSource): AnyBinaryBuilder;
  neq(value: ValueSource): AnyBinaryBuilder;
  gt(value: ValueSource): AnyBinaryBuilder;
  lt(value: ValueSource): AnyBinaryBuilder;
  gte(value: ValueSource): AnyBinaryBuilder;
  lte(value: ValueSource): AnyBinaryBuilder;
  asc(): AnyOrderBuilder;
  desc(): AnyOrderBuilder;

  /** Converts this expression builder to the underlying OperationExpr */
  toExpr(): OperationExpr;

  // Helper property for type extraction (not used at runtime)
  readonly __jsType: JsType;
}

// Helper aliases for usage sites where the specific column parameters are irrelevant
// Accepts any ColumnBuilder regardless of its Operations parameter
// Note: We use `any` here because TypeScript's variance rules don't allow us to express
// "any type that extends OperationTypes" in a way that works for assignment.
// Contract-specific OperationTypes (e.g., PgVectorOperationTypes) are not assignable
// to the base OperationTypes in generic parameter position, even though they extend it structurally.
// Helper type that accepts any ColumnBuilder regardless of its generic parameters
// This is needed because conditional types in ColumnBuilder create incompatible intersection types
// when Operations differs, even though structurally they're compatible
export type AnyColumnBuilderBase = {
  readonly kind: 'column';
  readonly table: string;
  readonly column: string;
  readonly columnMeta: StorageColumn;
  // Methods accept ValueSource (ParamPlaceholder or ExpressionSource)
  eq(value: ValueSource): AnyBinaryBuilder;
  neq(value: ValueSource): AnyBinaryBuilder;
  gt(value: ValueSource): AnyBinaryBuilder;
  lt(value: ValueSource): AnyBinaryBuilder;
  gte(value: ValueSource): AnyBinaryBuilder;
  lte(value: ValueSource): AnyBinaryBuilder;
  asc(): AnyOrderBuilder;
  desc(): AnyOrderBuilder;
  toExpr(): ColumnRef;
  readonly __jsType: unknown;
  // Optional nullable methods (present when columnMeta.nullable is true)
  isNull?(): AnyUnaryBuilder;
  isNotNull?(): AnyUnaryBuilder;
  // Allow any operation methods (from conditional type)
  readonly [key: string]: unknown;
};

export type AnyColumnBuilder =
  | ColumnBuilder<
      string,
      StorageColumn,
      unknown,
      // biome-ignore lint/suspicious/noExplicitAny: AnyColumnBuilder must accept column builders with any operation types
      any
    >
  | AnyColumnBuilderBase;

/**
 * Union type for any builder that can produce an Expression.
 * Used in DSL method signatures where either a column or operation result can be passed.
 */
export type AnyExpressionSource = AnyColumnBuilder | ExpressionBuilder;

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
 * Extracts the model name for a given table from the contract mappings.
 */
type ExtractTableToModel<
  Contract extends SqlContract<SqlStorage>,
  TableName extends string,
> = Contract['mappings'] extends {
  readonly tableToModel: infer TableToModel;
}
  ? TableToModel extends Record<string, string>
    ? TableName extends keyof TableToModel
      ? TableToModel[TableName]
      : never
    : never
  : never;

/**
 * Extracts the field name for a given table column from the contract mappings.
 */
type ExtractColumnToField<
  Contract extends SqlContract<SqlStorage>,
  TableName extends string,
  ColumnName extends string,
> = Contract['mappings'] extends {
  readonly columnToField: infer ColumnToField;
}
  ? ColumnToField extends Record<string, Record<string, string>>
    ? TableName extends keyof ColumnToField
      ? ColumnName extends keyof ColumnToField[TableName]
        ? ColumnToField[TableName][ColumnName]
        : never
      : never
    : never
  : never;

/**
 * Extracts the field value type from a model's fields.
 */
type ExtractFieldValue<
  Contract extends SqlContract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = Contract['models'] extends infer Models
  ? Models extends Record<string, unknown>
    ? ModelName extends keyof Models
      ? Models[ModelName] extends { readonly fields: infer Fields }
        ? Fields extends Record<string, unknown>
          ? FieldName extends keyof Fields
            ? Fields[FieldName]
            : never
          : never
        : never
      : never
    : never
  : never;

/**
 * Extracts the JavaScript type for a column from model mappings if available.
 * Returns `never` if the column maps to a ModelField object (which indicates
 * a relation that should fall through to codec-based type resolution).
 *
 * The check for ModelField uses `Exclude<keyof FieldValue, 'column'> extends never`
 * to ensure we only skip pure `{ column: string }` marker objects, not richer
 * object types that happen to include a `column` property.
 */
type ExtractColumnJsTypeFromModels<
  Contract extends SqlContract<SqlStorage>,
  TableName extends string,
  ColumnName extends string,
> = ExtractTableToModel<Contract, TableName> extends infer ModelName
  ? ModelName extends string
    ? ExtractColumnToField<Contract, TableName, ColumnName> extends infer FieldName
      ? FieldName extends string
        ? ExtractFieldValue<Contract, ModelName, FieldName> extends infer FieldValue
          ? FieldValue extends { readonly column: string }
            ? Exclude<keyof FieldValue, 'column'> extends never
              ? never
              : FieldValue
            : FieldValue
          : never
        : never
      : never
    : never
  : never;

/**
 * Resolves type params for a column from either:
 * - inline `columnMeta.typeParams`, or
 * - `columnMeta.typeRef` (resolving into `contract.storage.types[typeRef].typeParams`).
 */
type ResolveColumnTypeParams<
  Contract extends SqlContract<SqlStorage>,
  ColumnMeta extends StorageColumn,
> = ColumnMeta extends { typeParams: infer Params }
  ? Params extends object
    ? Params
    : undefined
  : ColumnMeta extends { typeRef: infer TypeRef extends string }
    ? Contract['storage'] extends { types: infer Types }
      ? Types extends Record<string, unknown>
        ? TypeRef extends keyof Types
          ? Types[TypeRef] extends { typeParams: infer Params }
            ? Params extends object
              ? Params
              : undefined
            : undefined
          : undefined
        : undefined
      : undefined
    : undefined;

/**
 * If a codec entry exposes a type-level parameterized output surface, compute the output type
 * for a specific params object. Falls back to `never` if not supported.
 *
 * This enables lane typing to incorporate `columnMeta.typeParams` without branching on codec IDs
 * in core lane code.
 */
type ExtractParameterizedCodecOutputType<
  CodecId extends string,
  Params,
  CodecTypes extends Record<string, { readonly output: unknown }>,
> = CodecId extends keyof CodecTypes
  ? CodecTypes[CodecId] extends { readonly parameterizedOutput: infer Fn }
    ? Fn extends (params: Params) => infer Out
      ? Out
      : never
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
 *   'pg/vector@1': {
 *     cosineDistance: {
 *       args: [{ kind: 'typeId'; type: 'pg/vector@1' }];
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
 * type Ops = OperationsForTypeId<'pg/vector@1', MyOperations>;
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
  ? AnyExpressionSource
  : Arg extends { kind: 'param' }
    ? ParamPlaceholder
    : Arg extends { kind: 'literal' }
      ? unknown
      : never;

/**
 * Maps operation return spec to return type.
 * Operations return ExpressionBuilder, not ColumnBuilder, because the result
 * represents an expression (OperationExpr) rather than a column reference.
 */
type OperationReturn<
  Returns extends ReturnSpec,
  _ColumnName extends string,
  _ColumnMeta extends StorageColumn,
  _JsType,
> = Returns extends { kind: 'builtin'; type: infer T }
  ? T extends 'number'
    ? ExpressionBuilder<number>
    : T extends 'boolean'
      ? ExpressionBuilder<boolean>
      : T extends 'string'
        ? ExpressionBuilder<string>
        : ExpressionBuilder<unknown>
  : Returns extends { kind: 'typeId' }
    ? ExpressionBuilder<unknown>
    : ExpressionBuilder<unknown>;

/**
 * Computes JavaScript type for a column at column creation time.
 *
 * Type inference:
 * - Read columnMeta.codecId as typeId string literal
 * - Look up CodecTypes[typeId].output
 * - Apply nullability: nullable ? Output | null : Output
 */
type ColumnMetaTypeId<ColumnMeta> = ColumnMeta extends { codecId: infer CodecId extends string }
  ? CodecId
  : ColumnMeta extends { type: infer TypeId extends string }
    ? TypeId
    : never;

export type ComputeColumnJsType<
  Contract extends SqlContract<SqlStorage>,
  TableName extends string,
  ColumnName extends string,
  ColumnMeta extends StorageColumn,
  CodecTypes extends Record<string, { readonly output: unknown }>,
> = ExtractColumnJsTypeFromModels<Contract, TableName, ColumnName> extends infer FromModels
  ? [FromModels] extends [never]
    ? ColumnMeta extends { nullable: infer Nullable }
      ? ColumnMetaTypeId<ColumnMeta> extends infer TypeId
        ? TypeId extends string
          ? ResolveColumnTypeParams<Contract, ColumnMeta> extends infer Params
            ? Params extends object
              ? ExtractParameterizedCodecOutputType<
                  TypeId,
                  Params,
                  CodecTypes
                > extends infer ParamOutput
                ? [ParamOutput] extends [never]
                  ? ExtractCodecOutputType<TypeId, CodecTypes> extends infer CodecOutput
                    ? [CodecOutput] extends [never]
                      ? unknown // Codec not found in CodecTypes
                      : Nullable extends true
                        ? CodecOutput | null
                        : CodecOutput
                    : unknown
                  : Nullable extends true
                    ? ParamOutput | null
                    : ParamOutput
                : unknown
              : ExtractCodecOutputType<TypeId, CodecTypes> extends infer CodecOutput
                ? [CodecOutput] extends [never]
                  ? unknown // Codec not found in CodecTypes
                  : Nullable extends true
                    ? CodecOutput | null
                    : CodecOutput
                : unknown
            : unknown
          : unknown
        : unknown
      : unknown
    : FromModels
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
type ExtractJsTypeFromColumnBuilder<CB extends AnyColumnBuilder> =
  CB extends ColumnBuilder<
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
 * Nested projection type - allows recursive nesting of ColumnBuilder, ExpressionBuilder, or nested objects.
 */
export type NestedProjection = Record<
  string,
  | AnyExpressionSource
  | Record<
      string,
      | AnyExpressionSource
      | Record<
          string,
          | AnyExpressionSource
          | Record<string, AnyExpressionSource | Record<string, AnyExpressionSource>>
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
  P extends Record<string, AnyExpressionSource | boolean | NestedProjection>,
  CodecTypes extends Record<string, { readonly output: unknown }> = Record<string, never>,
  Includes extends Record<string, unknown> = Record<string, never>,
> = {
  [K in keyof P]: P[K] extends ExpressionBuilder<infer JsType>
    ? JsType
    : P[K] extends AnyColumnBuilder
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
export type SqlPlan<Row = unknown> = ExecutionPlan<Row, QueryAst>;

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
) => ExecutionPlan;

export interface RawFactory extends RawTemplateFactory {
  (text: string, options: RawFunctionOptions): ExecutionPlan;
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

/**
 * SQL-specific ResultType that works with both Plan and SqlQueryPlan.
 * This extends the core ResultType to also handle SqlQueryPlan.
 * Example: `type Row = ResultType<typeof plan>`
 */
export type ResultType<P> = P extends SqlQueryPlan<infer R> ? R : CoreResultType<P>;
