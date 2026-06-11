import type { StorageHashBase } from '@prisma-next/contract/types';
import {
  freezeNode,
  IRNodeBase,
  type Namespace,
  type Storage,
} from '@prisma-next/framework-components/ir';
import type { MongoCollection, MongoCollectionInput } from './mongo-collection';

export type MongoNamespaceEntries = Readonly<Record<string, Readonly<Record<string, unknown>>>> & {
  readonly collection?: Readonly<Record<string, MongoCollection>>;
};

export interface MongoNamespaceCollectionsInput {
  readonly id: string;
  readonly entries: Readonly<Record<string, Readonly<Record<string, MongoCollectionInput>>>>;
}

export type MongoNamespace = Namespace & {
  readonly entries: MongoNamespaceEntries;
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
