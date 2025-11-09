import type { ContractBase } from '@prisma-next/contract/types';

// SQL family types
export type StorageColumn = {
  readonly type: string;
  readonly nullable: boolean;
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

export type SqlStorage = {
  readonly tables: Record<string, StorageTable>;
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
  /**
   * Types-only codec type mapping.
   * Provided via contract.d.ts imports from adapter/extension exports.
   * Not present in contract.json; compile-time only.
   */
  readonly codecTypes: Record<string, { readonly output: unknown }>;
  /**
   * Types-only operation type mapping.
   * Provided via contract.d.ts imports from adapter/extension exports.
   * Not present in contract.json; compile-time only.
   */
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
