/**
 * SQL-family payload an `AuthoringEntityRefTypeConstructorDescriptor.resolve` (framework
 * `framework-authoring.ts`) function returns when the consuming family is SQL (e.g. Postgres's
 * `pg.enum(<native_enum ref>)`). The framework hook returns an opaque `object` so each consuming
 * family defines its own payload shape; this is the SQL family's.
 */
export interface SqlEntityRefResolution {
  readonly codecId: string;
  readonly nativeType: string;
  /** Codec-instance params threaded onto the column (e.g. a native enum's `{ typeName }`), for codecs whose per-instance behavior is parameterized. */
  readonly typeParams?: Record<string, unknown>;
  /**
   * Names a value-set entry already derived for the same namespace
   * (`entries.valueSet[valueSetEntityName]`); the caller builds the storage-plane `ValueSetRef`
   * from this name plus the field's own namespace id.
   */
  readonly valueSetEntityName?: string;
}

/**
 * Structural check for {@link SqlEntityRefResolution}: no casts. A `resolve` payload failing this
 * predicate is a contributor bug in the pack that registered the entity-ref type constructor, not
 * a user-schema error — callers should throw, naming the constructor path.
 */
export function isSqlEntityRefResolution(payload: object): payload is SqlEntityRefResolution {
  if (!('codecId' in payload) || !('nativeType' in payload)) {
    return false;
  }
  return typeof payload.codecId === 'string' && typeof payload.nativeType === 'string';
}
