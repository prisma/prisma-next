import type { ContractBase } from '@prisma-next/contract/types';

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
 *
 * **Enums**: Enums are stored as parameterized types with `typeParams.values`
 * containing the ordered list of valid enum values. The codec (e.g., `pg/enum@1`)
 * determines how the enum is persisted and typed.
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
   *
   * Enums are also stored here as parameterized types with `typeParams.values`.
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
  readonly codecTypes: Record<string, { readonly output: unknown }>;
  readonly operationTypes: Record<string, Record<string, unknown>>;
};

export type SqlContract<
  S extends SqlStorage = SqlStorage,
  M extends Record<string, unknown> = Record<string, unknown>,
  R extends Record<string, unknown> = Record<string, unknown>,
  Map extends SqlMappings = SqlMappings,
> = ContractBase & {
  readonly targetFamily: string;
  readonly storage: S;
  readonly models: M;
  readonly relations: R;
  readonly mappings: Map;
};

export type ExtractCodecTypes<TContract extends SqlContract<SqlStorage>> =
  TContract['mappings']['codecTypes'];

export type ExtractOperationTypes<TContract extends SqlContract<SqlStorage>> =
  TContract['mappings']['operationTypes'];
