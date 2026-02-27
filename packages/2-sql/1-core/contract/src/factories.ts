import type {
  ExecutionHashBase,
  ProfileHashBase,
  StorageHashBase,
} from '@prisma-next/contract/types';
import type {
  Bm25FieldConfig,
  ForeignKey,
  ForeignKeyOptions,
  ForeignKeyReferences,
  Index,
  ModelDefinition,
  ModelField,
  ModelStorage,
  PrimaryKey,
  SqlContract,
  SqlMappings,
  SqlStorage,
  StorageColumn,
  StorageTable,
  UniqueConstraint,
} from './types';
import { applyFkDefaults } from './types';

/**
 * Creates a StorageColumn with nativeType and codecId.
 *
 * @param nativeType - Native database type identifier (e.g., 'int4', 'text', 'vector')
 * @param codecId - Codec identifier (e.g., 'pg/int4@1', 'pg/text@1')
 * @param nullable - Whether the column is nullable (default: false)
 * @returns StorageColumn with nativeType and codecId
 */
export function col(nativeType: string, codecId: string, nullable = false): StorageColumn {
  return {
    nativeType,
    codecId,
    nullable,
  };
}

export function pk(...columns: readonly string[]): PrimaryKey {
  return {
    columns,
  };
}

export function unique(...columns: readonly string[]): UniqueConstraint {
  return {
    columns,
  };
}

export function index(...columns: readonly string[]): Index {
  return {
    columns,
  };
}

/**
 * Creates a BM25 index definition for ParadeDB full-text search.
 */
export function bm25Index(opts: {
  keyField: string;
  fields: readonly Bm25FieldConfig[];
  name?: string;
}): Index {
  const columns = opts.fields.map((f) => f.column ?? f.alias ?? f.expression ?? '');
  return {
    columns,
    using: 'bm25',
    keyField: opts.keyField,
    fieldConfigs: opts.fields,
    ...(opts.name !== undefined && { name: opts.name }),
  };
}

/**
 * Creates a BM25 field config for a column reference.
 */
export function bm25Field(
  column: string,
  opts?: {
    tokenizer?: string;
    tokenizerParams?: Record<string, unknown>;
    alias?: string;
  },
): Bm25FieldConfig {
  return {
    column,
    ...(opts?.tokenizer !== undefined && { tokenizer: opts.tokenizer }),
    ...(opts?.tokenizerParams !== undefined && { tokenizerParams: opts.tokenizerParams }),
    ...(opts?.alias !== undefined && { alias: opts.alias }),
  };
}

/**
 * Creates a BM25 field config for a raw SQL expression.
 * `alias` is required for expression-based fields.
 */
export function bm25ExprField(
  expression: string,
  opts: {
    alias: string;
    tokenizer?: string;
    tokenizerParams?: Record<string, unknown>;
  },
): Bm25FieldConfig {
  return {
    expression,
    alias: opts.alias,
    ...(opts.tokenizer !== undefined && { tokenizer: opts.tokenizer }),
    ...(opts.tokenizerParams !== undefined && { tokenizerParams: opts.tokenizerParams }),
  };
}

export function fk(
  columns: readonly string[],
  refTable: string,
  refColumns: readonly string[],
  opts?: ForeignKeyOptions & { constraint?: boolean; index?: boolean },
): ForeignKey {
  const references: ForeignKeyReferences = {
    table: refTable,
    columns: refColumns,
  };

  return {
    columns,
    references,
    ...(opts?.name !== undefined && { name: opts.name }),
    ...(opts?.onDelete !== undefined && { onDelete: opts.onDelete }),
    ...(opts?.onUpdate !== undefined && { onUpdate: opts.onUpdate }),
    ...applyFkDefaults({ constraint: opts?.constraint, index: opts?.index }),
  };
}

export function table(
  columns: Record<string, StorageColumn>,
  opts?: {
    pk?: PrimaryKey;
    uniques?: readonly UniqueConstraint[];
    indexes?: readonly Index[];
    fks?: readonly ForeignKey[];
  },
): StorageTable {
  return {
    columns,
    ...(opts?.pk !== undefined && { primaryKey: opts.pk }),
    uniques: opts?.uniques ?? [],
    indexes: opts?.indexes ?? [],
    foreignKeys: opts?.fks ?? [],
  };
}

export function model(
  table: string,
  fields: Record<string, ModelField>,
  relations: Record<string, unknown> = {},
): ModelDefinition {
  const storage: ModelStorage = { table };
  return {
    storage,
    fields,
    relations,
  };
}

export function storage(tables: Record<string, StorageTable>): SqlStorage {
  return { tables };
}

export function contract<
  TStorageHash extends StorageHashBase<string> = StorageHashBase<string>,
  TExecutionHash extends ExecutionHashBase<string> = ExecutionHashBase<string>,
  TProfileHash extends ProfileHashBase<string> = ProfileHashBase<string>,
>(opts: {
  target: string;
  storageHash: TStorageHash;
  executionHash?: TExecutionHash;
  storage: SqlStorage;
  models?: Record<string, ModelDefinition>;
  relations?: Record<string, unknown>;
  mappings?: Partial<SqlMappings>;
  schemaVersion?: '1';
  targetFamily?: 'sql';
  profileHash?: TProfileHash;
  capabilities?: Record<string, Record<string, boolean>>;
  extensionPacks?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  sources?: Record<string, unknown>;
}): SqlContract<
  SqlStorage,
  Record<string, unknown>,
  Record<string, unknown>,
  SqlMappings,
  TStorageHash,
  TExecutionHash,
  TProfileHash
> {
  return {
    schemaVersion: opts.schemaVersion ?? '1',
    target: opts.target,
    targetFamily: opts.targetFamily ?? 'sql',
    storageHash: opts.storageHash,
    ...(opts.executionHash !== undefined && { executionHash: opts.executionHash }),
    storage: opts.storage,
    models: opts.models ?? {},
    relations: opts.relations ?? {},
    mappings: (opts.mappings ?? {}) as SqlMappings,
    ...(opts.profileHash !== undefined && { profileHash: opts.profileHash }),
    ...(opts.capabilities !== undefined && { capabilities: opts.capabilities }),
    ...(opts.extensionPacks !== undefined && { extensionPacks: opts.extensionPacks }),
    ...(opts.meta !== undefined && { meta: opts.meta }),
    ...(opts.sources !== undefined && { sources: opts.sources as Record<string, unknown> }),
  } as SqlContract<
    SqlStorage,
    Record<string, unknown>,
    Record<string, unknown>,
    SqlMappings,
    TStorageHash,
    TExecutionHash,
    TProfileHash
  >;
}
