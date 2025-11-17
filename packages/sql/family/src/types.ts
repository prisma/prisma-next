import type { SqlTypeMetadata, SqlTypeMetadataRegistry } from '@prisma-next/sql-schema-ir/types';

/**
 * Re-export types from sql-schema-ir for convenience.
 */
export type { SqlTypeMetadata, SqlTypeMetadataRegistry };

/**
 * Implementation of SqlTypeMetadataRegistry backed by an array.
 */
class SqlTypeMetadataRegistryImpl implements SqlTypeMetadataRegistry {
  private readonly _entries: readonly SqlTypeMetadata[];

  constructor(entries: ReadonlyArray<SqlTypeMetadata>) {
    this._entries = Object.freeze([...entries]);
  }

  values(): IterableIterator<SqlTypeMetadata> {
    return this._entries.values();
  }
}

/**
 * Creates a new SqlTypeMetadataRegistry from an array of metadata entries.
 * @internal - Used internally by createSqlTypeMetadataRegistry
 */
export function createSqlTypeMetadataRegistryFromEntries(
  entries: ReadonlyArray<SqlTypeMetadata>,
): SqlTypeMetadataRegistry {
  return new SqlTypeMetadataRegistryImpl(entries);
}
