import type {
  ColumnDefault,
  ContractBase,
  ExecutionHashBase,
  ExecutionSection,
  ProfileHashBase,
  StorageHashBase,
} from '@prisma-next/contract/types';

/**
 * A column definition in storage.
 *
 * `typeParams` is optional because most columns use non-parameterized types.
 * Columns with parameterized types can either inline `typeParams` or reference
 * a named {@link StorageTypeInstance} via `typeRef`.
 */
export type StorageColumn = {
  readonly nativeType: string;
  readonly codecId: string;
  readonly nullable: boolean;
  /**
   * Opaque, codec-owned JS/type parameters.
   * The codec that owns `codecId` defines the shape and semantics.
   * Mutually exclusive with `typeRef`.
   */
  readonly typeParams?: Record<string, unknown>;
  /**
   * Reference to a named type instance in `storage.types`.
   * Mutually exclusive with `typeParams`.
   */
  readonly typeRef?: string;
  /**
   * Default value for the column.
   * Can be a literal value or database function.
   */
  readonly default?: ColumnDefault;
};

export type PrimaryKey = {
  readonly columns: readonly string[];
  readonly name?: string;
};

export type UniqueConstraint = {
  readonly columns: readonly string[];
  readonly name?: string;
};

export type Index = {
  readonly columns: readonly string[];
  readonly name?: string;
};

export type ForeignKeyReferences = {
  readonly table: string;
  readonly columns: readonly string[];
};

export type ForeignKey = {
  readonly columns: readonly string[];
  readonly references: ForeignKeyReferences;
  readonly name?: string;
};

export type StorageTable = {
  readonly columns: Record<string, StorageColumn>;
  readonly primaryKey?: PrimaryKey;
  readonly uniques: ReadonlyArray<UniqueConstraint>;
  readonly indexes: ReadonlyArray<Index>;
  readonly foreignKeys: ReadonlyArray<ForeignKey>;
};

/**
 * A named, parameterized type instance.
 * These are registered in `storage.types` for reuse across columns
 * and to enable ergonomic schema surfaces like `schema.types.MyType`.
 *
 * Unlike {@link StorageColumn}, `typeParams` is required here because
 * `StorageTypeInstance` exists specifically to define reusable parameterized types.
 * A type instance without parameters would be redundant—columns can reference
 * the codec directly via `codecId`.
 */
export type StorageTypeInstance = {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams: Record<string, unknown>;
};

export type SqlStorage = {
  readonly tables: Record<string, StorageTable>;
  /**
   * Named type instances for parameterized/custom types.
   * Columns can reference these via `typeRef`.
   */
  readonly types?: Record<string, StorageTypeInstance>;
};

export type ModelField = {
  readonly column: string;
};

export type ModelStorage = {
  readonly table: string;
};

export type ModelDefinition = {
  readonly storage: ModelStorage;
  readonly fields: Record<string, ModelField>;
  readonly relations: Record<string, unknown>;
};

export type SqlMappings = {
  readonly modelToTable?: Record<string, string>;
  readonly tableToModel?: Record<string, string>;
  readonly fieldToColumn?: Record<string, Record<string, string>>;
  readonly columnToField?: Record<string, Record<string, string>>;
};

/**
 * Type-only maps for lane inference. Not runtime properties on Contract.
 * Emitted from contract.d.ts; carried via phantom for no-emit.
 */
export type TypeMaps<
  TCodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
  TOperationTypes extends Record<string, unknown> = Record<string, never>,
> = {
  readonly codecTypes: TCodecTypes;
  readonly operationTypes: TOperationTypes;
};

export type CodecTypesOf<T> = T extends { readonly codecTypes: infer C }
  ? C extends Record<string, { output: unknown }>
    ? C
    : Record<string, never>
  : Record<string, never>;

export type OperationTypesOf<T> = T extends { readonly operationTypes: infer O }
  ? O extends Record<string, unknown>
    ? O
    : Record<string, never>
  : Record<string, never>;

export type TypeMapsPhantomKey = '__@prisma-next/sql-contract/typeMaps@__';

/**
 * Phantom type for no-emit: carries TypeMaps for inference without runtime keys.
 * Must not introduce runtime properties.
 */
export type ContractWithTypeMaps<TContract, TTypeMaps> = TContract & {
  readonly '__@prisma-next/sql-contract/typeMaps@__'?: TTypeMaps;
};

export type SqlCodecTypesKey = '__@prisma-next/sql-contract/codecTypes@__';
export type SqlOperationTypesKey = '__@prisma-next/sql-contract/operationTypes@__';

export type SqlContract<
  S extends SqlStorage = SqlStorage,
  M extends Record<string, unknown> = Record<string, unknown>,
  R extends Record<string, unknown> = Record<string, unknown>,
  Map extends SqlMappings = SqlMappings,
  TStorageHash extends StorageHashBase<string> = StorageHashBase<string>,
  TExecutionHash extends ExecutionHashBase<string> = ExecutionHashBase<string>,
  TProfileHash extends ProfileHashBase<string> = ProfileHashBase<string>,
> = ContractBase<TStorageHash, TExecutionHash, TProfileHash> & {
  readonly targetFamily: string;
  readonly storage: S;
  readonly models: M;
  readonly relations: R;
  readonly mappings: Map;
  readonly execution?: ExecutionSection;
};

export type ExtractCodecTypes<T> = T extends {
  readonly '__@prisma-next/sql-contract/typeMaps@__'?: infer TM;
}
  ? CodecTypesOf<TM>
  : T extends { readonly [K in SqlCodecTypesKey]: infer C }
    ? C
    : Record<string, never>;

export type ExtractOperationTypes<T> = T extends {
  readonly '__@prisma-next/sql-contract/typeMaps@__'?: infer TM;
}
  ? OperationTypesOf<TM>
  : T extends { readonly [K in SqlOperationTypesKey]: infer O }
    ? O
    : Record<string, never>;
