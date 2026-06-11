import type { StorageHashBase } from '@prisma-next/contract/types';
import {
  freezeNode,
  IRNodeBase,
  type Namespace,
  type Storage,
} from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import type { MongoCollection, MongoCollectionInput } from './mongo-collection';

export interface MongoNamespaceCollectionsInput {
  readonly id: string;
  readonly entries: Readonly<
    Record<string, Readonly<Record<string, MongoCollection | MongoCollectionInput>>>
  >;
}

export type MongoNamespace = Namespace & {
  readonly entries: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
};

export interface MongoStorageInput<THash extends string = string> {
  readonly storageHash: StorageHashBase<THash>;
  readonly namespaces: Readonly<Record<string, MongoNamespace>>;
}

/**
 * Returns the `entries['collection']` map from a namespace, typed as a
 * `Record<string, MongoCollection>`. Use this in generic/structural code
 * where the static type is `MongoNamespace` rather than a class instance
 * with a `collection` getter.
 */
export function namespaceCollections(
  ns: MongoNamespace,
): Readonly<Record<string, MongoCollection>> {
  return blindCast<
    Readonly<Record<string, MongoCollection>>,
    'entries[collection] holds only MongoCollection by construction'
  >(ns.entries['collection'] ?? Object.freeze({}));
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
