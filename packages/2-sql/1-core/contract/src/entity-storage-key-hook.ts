/**
 * SQL-family extension to the framework entity-type authoring registry, sibling
 * to {@link import('./value-set-derivation-hook')}: a pack's entity-type
 * `factory` output may declare the STORAGE KEY its built entity lands under in
 * `entries.<kind>` — the entity's physical name, which per ADR 221 is the
 * coordinate `entityName` (e.g. a Postgres enum type's physical name
 * `aal_level`, not the authoring handle `AalLevel`).
 *
 * The generic authoring lowering keys pack entities by their author-declared
 * handle/block name (correct for role/policy, whose handle IS their physical
 * name). An entity whose authoring handle diverges from its physical name (a
 * native enum with `@@map`) declares this hook so it keys by the physical name
 * instead — exactly mirroring how a table keys `entries.table` by its `@@map`
 * name, not the model handle. Entities that omit the hook keep the handle key.
 *
 * SQL-family concept (the "physical name" is a storage-plane idiom), so this
 * hook lives here rather than on the framework `AuthoringEntityTypeFactoryOutput`.
 */
export interface SqlStorageKeyDerivingEntityTypeOutput {
  /**
   * Method syntax (bivariant) so a pack's concretely-typed
   * `storageKey(entity: PostgresNativeEnum) => string` stays structurally
   * compatible with this `unknown` parameter.
   */
  storageKey(entity: unknown): string;
}

/** Structural check for {@link SqlStorageKeyDerivingEntityTypeOutput}: no casts. */
export function providesStorageKey(
  output: unknown,
): output is SqlStorageKeyDerivingEntityTypeOutput {
  if (typeof output !== 'object' || output === null || !('storageKey' in output)) {
    return false;
  }
  const { storageKey } = output;
  return typeof storageKey === 'function';
}

/**
 * If `output` (an entity-type descriptor's factory output) declares
 * {@link SqlStorageKeyDerivingEntityTypeOutput.storageKey}, invoke it on
 * `entity` to get the physical storage key; otherwise return `undefined` so the
 * caller falls back to the authoring handle/block name.
 */
export function resolveEntityStorageKey(output: unknown, entity: unknown): string | undefined {
  if (!providesStorageKey(output)) return undefined;
  return output.storageKey(entity);
}
