import type { SchemaTypes } from '@pothos/core';

/**
 * Per-builder cache of model-name -> ObjectRef. Both `prismaObject` and
 * `t.relation` use this to ensure the *same* ref instance represents a
 * given model, so that `t.relation('posts')` produces a type that
 * `prismaObject('Post', ...)` later implements (rather than creating two
 * disconnected ObjectRef instances).
 */
const refCache = new WeakMap<object, Map<string, unknown>>();

export function getOrCreateModelRef(
  builder: PothosSchemaTypes.SchemaBuilder<SchemaTypes>,
  modelName: string,
): unknown {
  let cache = refCache.get(builder as unknown as object);
  if (!cache) {
    cache = new Map();
    refCache.set(builder as unknown as object, cache);
  }
  let ref = cache.get(modelName);
  if (!ref) {
    ref = (builder as unknown as { objectRef: (n: string) => unknown }).objectRef(modelName);
    cache.set(modelName, ref);
  }
  return ref;
}
