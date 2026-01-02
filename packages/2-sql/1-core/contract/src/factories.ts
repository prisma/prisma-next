import type {
  ForeignKey,
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

export function fk(
  columns: readonly string[],
  refTable: string,
  refColumns: readonly string[],
  name?: string,
): ForeignKey {
  const references: ForeignKeyReferences = {
    table: refTable,
    columns: refColumns,
  };
  return {
    columns,
    references,
    ...(name !== undefined && { name }),
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

export function contract(opts: {
  target: string;
  coreHash: string;
  storage: SqlStorage;
  models?: Record<string, ModelDefinition>;
  relations?: Record<string, unknown>;
  mappings?: Partial<SqlMappings>;
  schemaVersion?: '1';
  targetFamily?: 'sql';
  profileHash?: string;
  capabilities?: Record<string, Record<string, boolean>>;
  extensionPacks?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  sources?: Record<string, unknown>;
}): SqlContract {
  return {
    schemaVersion: opts.schemaVersion ?? '1',
    target: opts.target,
    targetFamily: opts.targetFamily ?? 'sql',
    coreHash: opts.coreHash,
    storage: opts.storage,
    models: opts.models ?? {},
    relations: opts.relations ?? {},
    mappings: (opts.mappings ?? {}) as SqlMappings,
    ...(opts.profileHash !== undefined && { profileHash: opts.profileHash }),
    ...(opts.capabilities !== undefined && { capabilities: opts.capabilities }),
    ...(opts.extensionPacks !== undefined && { extensionPacks: opts.extensionPacks }),
    ...(opts.meta !== undefined && { meta: opts.meta }),
    ...(opts.sources !== undefined && { sources: opts.sources as Record<string, unknown> }),
  } as SqlContract;
}
