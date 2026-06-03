import type { StorageHashBase } from '@prisma-next/contract/types';
import {
  freezeNode,
  IRNodeBase,
  type Namespace,
  type Storage,
} from '@prisma-next/framework-components/ir';
import type { MongoCollection, MongoCollectionInput } from './mongo-collection';

export interface MongoNamespaceCollectionsInput {
  readonly id: string;
  readonly entries?: {
    readonly collection?: Record<string, MongoCollection | MongoCollectionInput>;
  };
}

// Mongo concretions store `MongoCollection` instances under
// `entries.collection` (Mongo idiom — distinct from the SQL family's
// `entries.table`). Narrowing the namespace map here lets target/family-
// level consumers iterate collection slots and recover the concrete type
// without the framework's wider `Namespace` tripping them up.
export type MongoNamespace = Namespace & {
  readonly entries: Readonly<{
    readonly collection: Readonly<Record<string, MongoCollection>>;
  }>;
};

export interface MongoStorageInput<THash extends string = string> {
  readonly storageHash: StorageHashBase<THash>;
  readonly namespaces: Readonly<Record<string, MongoNamespace>>;
}

export class MongoStorage<THash extends string = string> extends IRNodeBase implements Storage {
  declare readonly kind: 'mongo-storage';
  readonly storageHash: StorageHashBase<THash>;
  readonly namespaces: Readonly<Record<string, MongoNamespace>>;

  constructor(input: MongoStorageInput<THash>) {
    super();
    Object.defineProperty(this, 'kind', {
      value: 'mongo-storage',
      writable: false,
      enumerable: false,
      configurable: true,
    });
    this.storageHash = input.storageHash;
    this.namespaces = Object.freeze(input.namespaces);
    freezeNode(this);
  }
}
