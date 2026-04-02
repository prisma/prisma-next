import type {
  Contract,
  ResultType as CoreResultType,
  ExecutionPlan,
  PlanRefs,
} from '@prisma-next/contract/types';
import type { ParamSpec } from '@prisma-next/operations';
import type { ExtractCodecTypes, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type { SqlLoweringSpec } from '@prisma-next/sql-operations';
import type { AnyQueryAst, ColumnRef, ParamRef } from './ast/types';
import type { SqlQueryPlan } from './plan';
import type { ExecutionContext } from './query-lane-context';

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
 * Extracts the model name for a given table by iterating models to find the one
 * whose `storage.table` matches.
 */
type ExtractTableToModel<
  TContract extends Contract<SqlStorage>,
  TableName extends string,
> = TContract['models'] extends infer Models extends Record<string, unknown>
  ? {
      [M in keyof Models & string]: Models[M] extends {
        readonly storage: { readonly table: TableName };
      }
        ? M
        : never;
    }[keyof Models & string]
  : never;

/**
 * Extracts the field name for a given column by finding the field in
 * `model.storage.fields` whose `column` matches.
 */
type ExtractColumnToField<
  TContract extends Contract<SqlStorage>,
  TableName extends string,
  ColumnName extends string,
> = ExtractTableToModel<TContract, TableName> extends infer ModelName extends string
  ? TContract['models'] extends infer Models extends Record<string, unknown>
    ? ModelName & keyof Models extends infer MKey extends string
      ? Models[MKey] extends {
          readonly storage: { readonly fields: infer Fields extends Record<string, unknown> };
        }
        ? {
            [F in keyof Fields & string]: Fields[F] extends { readonly column: ColumnName }
              ? F
              : never;
          }[keyof Fields & string]
        : never
      : never
    : never
  : never;

type ExtractFieldValue<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  FieldName extends string,
> = TContract['models'] extends infer Models
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

type ApplyNullability<T, Nullable> = Nullable extends true ? T | null : T;

type ApplyFieldModifiers<T, FieldValue, Nullable> = FieldValue extends { readonly many: true }
  ? ApplyNullability<T[], Nullable>
  : FieldValue extends { readonly dict: true }
    ? ApplyNullability<Record<string, T>, Nullable>
    : ApplyNullability<T, Nullable>;

type ExtractValueObject<
  TContract extends Contract<SqlStorage>,
  Name extends string,
> = TContract extends { readonly valueObjects: infer VOs }
  ? VOs extends Record<string, { readonly fields: Record<string, unknown> }>
    ? Name extends keyof VOs
      ? VOs[Name]
      : never
    : never
  : never;

type ExpandValueObjectFields<
  TContract extends Contract<SqlStorage>,
  Fields extends Record<string, unknown>,
> = {
  [K in keyof Fields & string]: ResolveModelFieldToJsType<TContract, Fields[K]>;
};

type ResolveValueObjectJsType<
  TContract extends Contract<SqlStorage>,
  Name extends string,
> = ExtractValueObject<TContract, Name> extends infer VO
  ? VO extends { readonly fields: infer F extends Record<string, unknown> }
    ? ExpandValueObjectFields<TContract, F>
    : never
  : never;

type ResolveModelFieldToJsType<
  TContract extends Contract<SqlStorage>,
  FieldValue,
> = FieldValue extends {
  readonly nullable: infer Nullable;
  readonly type: infer FT;
}
  ? FT extends { readonly kind: 'scalar'; readonly codecId: infer Id extends string }
    ? Id extends keyof ExtractCodecTypes<TContract>
      ? ExtractCodecTypes<TContract>[Id] extends { readonly output: infer O }
        ? ApplyFieldModifiers<O, FieldValue, Nullable>
        : never
      : never
    : FT extends { readonly kind: 'valueObject'; readonly name: infer Name extends string }
      ? ResolveValueObjectJsType<TContract, Name> extends infer VOType
        ? [VOType] extends [never]
          ? unknown
          : ApplyFieldModifiers<VOType, FieldValue, Nullable>
        : unknown
      : FT extends { readonly kind: 'union' }
        ? unknown
        : FieldValue
  : FieldValue;

type ExtractColumnJsTypeFromModels<
  TContract extends Contract<SqlStorage>,
  TableName extends string,
  ColumnName extends string,
> = ExtractTableToModel<TContract, TableName> extends infer ModelName
  ? ModelName extends string
    ? ExtractColumnToField<TContract, TableName, ColumnName> extends infer FieldName
      ? FieldName extends string
        ? ResolveModelFieldToJsType<TContract, ExtractFieldValue<TContract, ModelName, FieldName>>
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
  TContract extends Contract<SqlStorage>,
  ColumnMeta extends StorageColumn,
> = ColumnMeta extends { typeParams: infer Params }
  ? Params extends object
    ? Params
    : undefined
  : ColumnMeta extends { typeRef: infer TypeRef extends string }
    ? TContract['storage'] extends { types: infer Types }
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
 * Represents an operation at the type level for use in contract type maps.
 */
export type OperationTypeSignature = {
  readonly args: ReadonlyArray<ParamSpec>;
  readonly returns: ParamSpec;
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
 *       args: [{ codecId: 'pg/vector@1'; nullable: false }];
 *       returns: { codecId: 'core/float8'; nullable: false };
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
  TContract extends Contract<SqlStorage>,
  TableName extends string,
  ColumnName extends string,
  ColumnMeta extends StorageColumn,
  CodecTypes extends Record<string, { readonly output: unknown }>,
> = ExtractColumnJsTypeFromModels<TContract, TableName, ColumnName> extends infer FromModels
  ? [FromModels] extends [never]
    ? ColumnMeta extends { nullable: infer Nullable }
      ? ColumnMetaTypeId<ColumnMeta> extends infer TypeId
        ? TypeId extends string
          ? ResolveColumnTypeParams<TContract, ColumnMeta> extends infer Params
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
 * Utility type to check if a contract has the required capabilities for includeMany.
 * Requires both `lateral` and `jsonAgg` to be `true` in the contract's capabilities for the target.
 * Capabilities are nested by target: `{ [target]: { lateral: true, jsonAgg: true } }`
 */
export type HasIncludeManyCapabilities<TContract extends Contract<SqlStorage>> = TContract extends {
  capabilities: infer C;
  target: infer T;
}
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
 * SQL-specific Plan type that refines the ast field to use AnyQueryAst.
 * This is the type used by SQL query builders.
 */
export type SqlPlan<Row = unknown> = ExecutionPlan<Row, AnyQueryAst>;

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

export interface RuntimeError extends Error {
  readonly code: string;
  readonly category: 'PLAN';
  readonly severity: 'error';
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

export interface SqlBuilderOptions<TContract extends Contract<SqlStorage> = Contract<SqlStorage>> {
  readonly context: ExecutionContext<TContract>;
}

/**
 * SQL-specific ResultType that works with both Plan and SqlQueryPlan.
 * This extends the core ResultType to also handle SqlQueryPlan.
 * Example: `type Row = ResultType<typeof plan>`
 */
export type ResultType<P> = P extends SqlQueryPlan<infer R> ? R : CoreResultType<P>;
