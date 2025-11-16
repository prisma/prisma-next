/**
 * SQL type metadata for control-plane and execution-plane type availability and mapping.
 * This abstraction provides a read-only view of type information without encode/decode behavior.
 */
export interface SqlTypeMetadata {
  /**
   * Namespaced type identifier in format 'namespace/name@version'
   * Examples: 'pg/int4@1', 'pg/text@1', 'pg/timestamptz@1'
   */
  readonly typeId: string;

  /**
   * Contract scalar type IDs that this type can handle.
   * Examples: ['text'], ['int4', 'float8'], ['timestamp', 'timestamptz']
   */
  readonly targetTypes: readonly string[];

  /**
   * Native database type name (target-specific).
   * Examples: 'integer', 'text', 'character varying', 'timestamp with time zone'
   * This is optional because not all types have a native database representation.
   */
  readonly nativeType?: string;
}

/**
 * Registry interface for SQL type metadata.
 * Provides read-only iteration over type metadata entries.
 */
export interface SqlTypeMetadataRegistry {
  /**
   * Returns an iterator over all type metadata entries.
   */
  values(): IterableIterator<SqlTypeMetadata>;
}

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
