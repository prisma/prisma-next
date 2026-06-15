import { blindCast } from '@prisma-next/utils/casts';
import { MongoCollection, type MongoCollectionInput } from './ir/mongo-collection';

export type MongoEntryFactory = (value: unknown) => unknown;

const collectionFactory: MongoEntryFactory = (v) =>
  new MongoCollection(
    blindCast<
      MongoCollectionInput,
      'mongo-entry-construction-registry: collection entry is MongoCollectionInput'
    >(v),
  );

/**
 * Builds the per-namespace entry construction registry for Mongo. The core
 * kind is `collection`; target packs contribute additional kinds via
 * `packFactories`. Throws when a pack factory collides with `collection`.
 */
export function createMongoEntryConstructionRegistry(
  packFactories?: ReadonlyMap<string, MongoEntryFactory>,
): ReadonlyMap<string, MongoEntryFactory> {
  const registry = new Map<string, MongoEntryFactory>([['collection', collectionFactory]]);
  if (packFactories !== undefined) {
    for (const [kind, factory] of packFactories) {
      if (registry.has(kind)) {
        throw new Error(
          `createMongoEntryConstructionRegistry: pack factory "${kind}" collides with a core kind — pack factories cannot override "collection"`,
        );
      }
      registry.set(kind, factory);
    }
  }
  return registry;
}

/**
 * Dispatch loop for Mongo construction sites. For each kind in `entries`: if
 * the registry has a factory, apply it to produce IR instances; otherwise
 * freeze-and-carry the map unchanged (open-world semantics for construction).
 */
export function dispatchMongoEntriesToRegistryCarrying(
  entries: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  registry: ReadonlyMap<string, MongoEntryFactory>,
): Record<string, Readonly<Record<string, unknown>>> {
  const result: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const [kind, rawMap] of Object.entries(entries)) {
    const factory = registry.get(kind);
    if (factory !== undefined) {
      const built: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(rawMap)) {
        built[name] = factory(value);
      }
      result[kind] = Object.freeze(built);
    } else {
      result[kind] = Object.freeze(rawMap);
    }
  }
  return result;
}

/**
 * Dispatch loop for Mongo hydration sites. For each kind in `entries`: if the
 * registry has a factory, apply it to produce IR instances. Unknown kinds throw
 * (fail-closed), preserving the existing Mongo serializer semantics.
 */
export function dispatchMongoEntriesToRegistry(
  entries: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  registry: ReadonlyMap<string, MongoEntryFactory>,
  nsId?: string,
): Record<string, Readonly<Record<string, unknown>>> {
  const result: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const [kind, rawMap] of Object.entries(entries)) {
    const factory = registry.get(kind);
    if (factory !== undefined) {
      const built: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(rawMap)) {
        built[name] = factory(value);
      }
      result[kind] = Object.freeze(built);
    } else {
      throw new Error(
        `Unknown entries key "${kind}" in namespace "${nsId ?? '?'}"; no hydration factory registered for this entity kind`,
      );
    }
  }
  return result;
}
