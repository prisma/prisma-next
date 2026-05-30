import type { StorageHashBase } from '@prisma-next/contract/types';
import {
  flatStorageInput,
  freezeNode,
  IRNodeBase,
  isStoragePlaneReservedKey,
  type Namespace,
  type Storage,
} from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import type { MongoCollection, MongoCollectionInput } from './mongo-collection';

export interface MongoNamespaceCollectionsInput {
  readonly id: string;
  readonly collections?: Record<string, MongoCollection | MongoCollectionInput>;
}

// Mongo concretions always store `MongoCollection` instances in
// `collections` (Mongo idiom — distinct from the SQL family's `tables`).
// Narrowing the namespace map here lets target/family-level consumers
// iterate namespace collections and recover the concrete collection type
// without the framework's wider `Namespace` tripping them up.
export type MongoNamespace = Namespace & {
  readonly collections: Readonly<Record<string, MongoCollection>>;
};

export type MongoStorageInput<THash extends string = string> = {
  readonly storageHash: StorageHashBase<THash>;
} & Readonly<Record<string, MongoNamespace>>;

export type MongoStorageNamespacesInput<THash extends string = string> = {
  readonly storageHash: StorageHashBase<THash>;
  readonly namespaces: Readonly<Record<string, MongoNamespace>>;
};

export function buildMongoStorageInput<THash extends string>(
  input: MongoStorageNamespacesInput<THash>,
): MongoStorageInput<THash> {
  // `flatStorageInput` carries a shared optional `types?` slot that
  // `MongoStorageInput` omits, so the spread result is not nominally the
  // Mongo input type even though it is structurally the flat Mongo storage.
  return blindCast<
    MongoStorageInput<THash>,
    'flatStorageInput exposes an optional types slot MongoStorageInput omits; the spread is otherwise the flat Mongo storage input'
  >(
    flatStorageInput({
      storageHash: input.storageHash,
      namespaces: input.namespaces,
    }),
  );
}

export class MongoStorage<THash extends string = string> extends IRNodeBase implements Storage {
  declare readonly kind: 'mongo-storage';
  readonly storageHash: StorageHashBase<THash>;

  constructor(input: MongoStorageInput<THash>) {
    super();
    Object.defineProperty(this, 'kind', {
      value: 'mongo-storage',
      writable: false,
      enumerable: false,
      configurable: true,
    });
    this.storageHash = input.storageHash;
    for (const [key, value] of Object.entries(input)) {
      if (isStoragePlaneReservedKey(key)) continue;
      Object.defineProperty(this, key, {
        value: Object.freeze(value),
        writable: false,
        enumerable: true,
        configurable: false,
      });
    }
    freezeNode(this);
  }
}
