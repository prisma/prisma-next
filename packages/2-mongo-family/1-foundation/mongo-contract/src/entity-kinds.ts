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
 * Builds the descriptor map for Mongo namespaces. Core kind is `collection`;
 * target packs contribute additional kinds via `packKinds`.
 *
 * Throws when a pack kind collides with a core kind.
 */
export function composeMongoEntityKinds(
  packKinds: readonly AnyEntityKindDescriptor[] = [],
): ReadonlyMap<string, AnyEntityKindDescriptor> {
  const kinds = new Map<string, AnyEntityKindDescriptor>([['collection', collectionEntityKind]]);
  for (const descriptor of packKinds) {
    if (kinds.has(descriptor.kind)) {
      throw new Error(
        `composeMongoEntityKinds: pack kind "${descriptor.kind}" collides with a core kind — pack kinds cannot override "collection"`,
      );
    }
    kinds.set(descriptor.kind, descriptor);
  }
  return kinds;
}
