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

import type { Plan, PlanRefs } from '@prisma-next/contract/types';
import type {
  Adapter,
  ArgSpec,
  ColumnRef,
  Direction,
  LoweredStatement,
  LoweringSpec,
  ParamRef,
  QueryAst,
  ReturnSpec,
  SqlContract,
  SqlStorage,
  StorageColumn,
} from '@prisma-next/sql-target';

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
  readonly returns: ReturnSpec;
  readonly lowering: LoweringSpec;
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
 * Type-level operation signature.
 * Represents an operation at the type level, similar to OperationSignature at runtime.
 */
export type OperationTypeSignature = {
  readonly args: ReadonlyArray<ArgSpec>;
  readonly returns: ReturnSpec;
  readonly lowering: LoweringSpec;
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
export type CodecTypes = Record<string, { output: unknown }>;

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
> = TypeId extends keyof Operations ? Operations[TypeId] : Record<string, never>;

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
 * - typeId args: ParamPlaceholder (for now, could be ColumnBuilder in future)
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
  ? ParamPlaceholder
  : Arg extends { kind: 'param' }
    ? ParamPlaceholder
    : Arg extends { kind: 'literal' }
      ? unknown
      : never;

/**
 * Maps operation return spec to return type.
 * - builtin types: BinaryBuilder with appropriate return type
 * - typeId types: ColumnBuilder (for now, could be more specific in future)
 */
type OperationReturn<
  Returns extends ReturnSpec,
  ColumnName extends string,
  ColumnMeta extends StorageColumn,
  _JsType,
> = Returns extends { kind: 'builtin'; type: infer T }
  ? T extends 'number'
    ? BinaryBuilder<ColumnName, ColumnMeta, number>
    : T extends 'boolean'
      ? BinaryBuilder<ColumnName, ColumnMeta, boolean>
      : T extends 'string'
        ? BinaryBuilder<ColumnName, ColumnMeta, string>
        : BinaryBuilder<ColumnName, ColumnMeta, unknown>
  : Returns extends { kind: 'typeId' }
    ? ColumnBuilder<string, StorageColumn, unknown>
    : BinaryBuilder<ColumnName, ColumnMeta, unknown>;

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
/**
 * Extracts JsType from a ColumnBuilder.
 * Directly accesses the __jsType property.
 */
type ExtractJsTypeFromColumnBuilder<CB extends ColumnBuilder> = CB['__jsType'];

export type InferProjectionRow<P extends Record<string, ColumnBuilder>> = {
  [K in keyof P]: ExtractJsTypeFromColumnBuilder<P[K]>;
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
  [K in keyof P]: P[K] extends ColumnBuilder
    ? ExtractJsTypeFromColumnBuilder<P[K]>
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

// Re-export Plan types from contract for backward compatibility
export type { ParamDescriptor, PlanMeta, PlanRefs, ResultType } from '@prisma-next/contract/types';

// Re-export AST types from sql-target for backward compatibility
export type {
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  Direction,
  ExistsExpr,
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
