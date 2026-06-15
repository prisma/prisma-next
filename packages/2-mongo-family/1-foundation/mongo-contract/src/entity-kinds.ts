import type {
  AnyEntityKindDescriptor,
  EntityKindDescriptor,
} from '@prisma-next/framework-components/ir';
import { StorageCollectionSchema } from './contract-schema';
import { MongoCollection, type MongoCollectionInput } from './ir/mongo-collection';

export const collectionEntityKind: EntityKindDescriptor<MongoCollectionInput, MongoCollection> = {
  kind: 'collection',
  schema: StorageCollectionSchema,
  construct: (input) => new MongoCollection(input),
};

/**
 * Assembles the `kind → descriptor` registry for Mongo namespaces: the built-in
 * `collection` kind plus any target `packKinds`. This builds the lookup table —
 * it does not touch contract data. `hydrateNamespaceEntities` later consumes
 * this registry to turn a namespace's raw entries into IR instances. Throws on
 * a duplicate kind.
 */
export function composeMongoEntityKinds(
  packKinds: readonly AnyEntityKindDescriptor[] = [],
): ReadonlyMap<string, AnyEntityKindDescriptor> {
  const kinds = new Map<string, AnyEntityKindDescriptor>([['collection', collectionEntityKind]]);
  for (const descriptor of packKinds) {
    if (kinds.has(descriptor.kind)) {
      throw new Error(
        `composeMongoEntityKinds: duplicate entity kind "${descriptor.kind}" — each kind may be registered only once`,
      );
    }
    kinds.set(descriptor.kind, descriptor);
  }
  return kinds;
}
