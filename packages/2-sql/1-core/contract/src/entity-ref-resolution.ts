/**
 * SQL-family payload an `AuthoringEntityRefTypeConstructorDescriptor.resolve` (framework
 * `framework-authoring.ts`) function returns when the consuming family is SQL (e.g. Postgres's
 * `pg.enum(<native_enum ref>)`). The framework hook returns an opaque `object` so each consuming
 * family defines its own payload shape; this is the SQL family's — a resolved column binding, the
 * same three generic fields any parameterized-codec-plus-value-set column carries. The native type
 * is not part of this payload: it is derived from `typeParams.typeName`, the same way the codec's
 * own `nativeTypeFor` hook derives it (see `native-type-hook.ts`).
 */
export interface SqlColumnBinding {
  readonly codecId: string;
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
 * Structural check for {@link SqlColumnBinding}: no casts. A `resolve` payload failing this
 * predicate is a contributor bug in the pack that registered the entity-ref type constructor, not
 * a user-schema error — callers should throw, naming the constructor path.
 */
export function isSqlColumnBinding(value: object): value is SqlColumnBinding {
  return 'codecId' in value && typeof value.codecId === 'string';
}
