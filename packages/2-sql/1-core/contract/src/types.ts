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

/**
 * Supported index access methods.
 * Only includes methods with deliberate IR support — each access method
 * may carry its own config shape (e.g., BM25 needs `keyField` + `fieldConfigs`).
 */
export type IndexAccessMethod = 'btree' | 'bm25';

/**
 * Per-field configuration for a BM25 full-text search index.
 * Each entry describes one indexed field and its tokenizer settings.
 *
 * Either `column` or `expression` must be set, but not both.
 */
export type Bm25FieldConfig = {
  /** Column name. Mutually exclusive with `expression`. */
  readonly column?: string;
  /** Raw SQL expression (e.g., "description || ' ' || category"). Mutually exclusive with `column`. */
  readonly expression?: string;
  /** Tokenizer ID (e.g., 'unicode', 'simple', 'ngram', 'icu', 'regex_pattern', 'literal'). */
  readonly tokenizer?: string;
  /** Tokenizer parameters (e.g., { min: 2, max: 5 } for ngram). */
  readonly tokenizerParams?: Record<string, unknown>;
  /** Alias for multi-tokenizer per field. Required when `expression` is used. */
  readonly alias?: string;
};

export type Index = {
  readonly columns: readonly string[];
  readonly name?: string;
  /** Access method. Defaults to 'btree' when omitted. */
  readonly using?: IndexAccessMethod;
  /** BM25-specific: unique column used as the document key. */
  readonly keyField?: string;
  /** BM25-specific: per-field tokenizer configuration. */
  readonly fieldConfigs?: readonly Bm25FieldConfig[];
};

export type ForeignKeyReferences = {
  readonly table: string;
  readonly columns: readonly string[];
};

export type ReferentialAction = 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';

export type ForeignKeyOptions = {
  readonly name?: string;
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
};

export type ForeignKey = {
  readonly columns: readonly string[];
  readonly references: ForeignKeyReferences;
  readonly name?: string;
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
  /** Whether to emit FK constraint DDL (ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY). */
  readonly constraint: boolean;
  /** Whether to emit a backing index for the FK columns. */
  readonly index: boolean;
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
  readonly codecTypes: Record<string, { readonly output: unknown }>;
  readonly operationTypes: Record<string, Record<string, unknown>>;
};

export const DEFAULT_FK_CONSTRAINT = true;
export const DEFAULT_FK_INDEX = true;

/**
 * Resolves foreign key `constraint` and `index` fields to their effective boolean values,
 * falling back through optional override defaults, then to the global defaults.
 */
export function applyFkDefaults(
  fk: { constraint?: boolean | undefined; index?: boolean | undefined },
  overrideDefaults?: { constraint?: boolean | undefined; index?: boolean | undefined },
): { constraint: boolean; index: boolean } {
  return {
    constraint: fk.constraint ?? overrideDefaults?.constraint ?? DEFAULT_FK_CONSTRAINT,
    index: fk.index ?? overrideDefaults?.index ?? DEFAULT_FK_INDEX,
  };
}

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

export type ExtractCodecTypes<TContract extends SqlContract<SqlStorage>> =
  TContract['mappings']['codecTypes'];

export type ExtractOperationTypes<TContract extends SqlContract<SqlStorage>> =
  TContract['mappings']['operationTypes'];
