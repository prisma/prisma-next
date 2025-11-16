import type { ContractBase } from '@prisma-next/contract/types';
import type { TargetFamilyContext } from '@prisma-next/core-control-plane/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';

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

/**
 * Codec interface for SQL control-plane operations.
 * This is a minimal interface that defines the structure of codecs
 * used in control-plane operations (e.g., schema verification).
 * The concrete implementation lives in sql/lanes/relational-core.
 */
export interface Codec<Id extends string = string, TWire = unknown, TJs = unknown> {
  /**
   * Namespaced codec identifier in format 'namespace/name@version'
   * Examples: 'pg/text@1', 'pg/uuid@1', 'pg/timestamptz@1'
   */
  readonly id: Id;

  /**
   * Contract scalar type IDs that this codec can handle.
   * Examples: ['text'], ['int4', 'float8'], ['timestamp', 'timestamptz']
   */
  readonly targetTypes: readonly string[];

  /**
   * Decode a wire value (from database) to JavaScript type.
   * Must be synchronous and pure (no side effects).
   */
  decode(wire: TWire): TJs;

  /**
   * Encode a JavaScript value to wire format (for database).
   * Optional - if not provided, values pass through unchanged.
   * Must be synchronous and pure (no side effects).
   */
  encode?(value: TJs): TWire;
}

/**
 * Registry interface for codecs organized by ID and by contract scalar type.
 * This is a control-plane interface used for schema verification and introspection.
 * The concrete implementation lives in sql/lanes/relational-core.
 *
 * The registry allows looking up codecs by their namespaced ID or by the
 * contract scalar types they handle. Multiple codecs may handle the same
 * scalar type; ordering in getByScalar reflects preference (adapter first,
 * then packs, then app overrides).
 */
export interface SqlCodecRegistry {
  get(id: string): Codec<string> | undefined;
  has(id: string): boolean;
  getByScalar(scalar: string): readonly Codec<string>[];
  getDefaultCodec(scalar: string): Codec<string> | undefined;
  register(codec: Codec<string>): void;
  [Symbol.iterator](): Iterator<Codec<string>>;
  values(): IterableIterator<Codec<string>>;
}

/**
 * SQL family context that binds together schema IR and codec registry.
 * This is the SQL family's instantiation of TargetFamilyContext, adding SQL-specific control-plane state.
 *
 * Moved to sql-contract (shared plane) to avoid cyclic dependencies with CLI.
 */
export type SqlFamilyContext = TargetFamilyContext<SqlSchemaIR> & {
  readonly codecRegistry: SqlCodecRegistry;
};
