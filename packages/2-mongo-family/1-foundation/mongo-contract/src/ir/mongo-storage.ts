import type { StorageHashBase } from '@prisma-next/contract/types';
import {
  freezeNode,
  IRNodeBase,
  type Namespace,
  type Storage,
} from '@prisma-next/framework-components/ir';
import type { MongoCollection } from './mongo-collection';

/**
 * Construction input shape for {@link MongoStorage}. Mirrors the
 * required runtime fields explicitly so the family-base serializer's
 * hydration walker can hand the class a typed literal.
 */
export interface MongoStorageInput<THash extends string = string> {
  readonly storageHash: StorageHashBase<THash>;
  readonly collections: Readonly<Record<string, MongoCollection>>;
  readonly namespaces: Readonly<Record<string, Namespace>>;
}

/**
 * Mongo family storage IR class. Carries the family-shared
 * `storage.collections` map alongside the framework-promised
 * `namespaces` map — single concrete class at the family layer (the
 * Mongo family has one target today, and the data shape is uniform
 * across the family; no abstract base earns its existence yet).
 *
 * `namespaces` is supplied by the caller. The Mongo target wraps a
 * deserialized `MongoContract` envelope at
 * `MongoTargetContractSerializer.constructTargetContract`, providing
 * the default `{ [UNSPECIFIED_NAMESPACE_ID]:
 * MongoTargetUnspecifiedDatabase.instance }` map at that target-layer
 * site. The foundation-layer class stays target-agnostic.
 *
 * Constructed instances are frozen via `freezeNode(this)`; instance
 * fields are JSON-clean by construction (`storageHash`, `collections`,
 * `namespaces` all enumerable own properties). The persisted on-disk
 * envelope shape is target-owned: `MongoTargetContractSerializer.serializeContract`
 * decides whether `namespaces` round-trips through JSON or is stripped
 * for the JSON envelope.
 */
export class MongoStorage<THash extends string = string> extends IRNodeBase implements Storage {
  readonly kind = 'mongo-storage' as const;
  readonly storageHash: StorageHashBase<THash>;
  readonly collections: Readonly<Record<string, MongoCollection>>;
  readonly namespaces: Readonly<Record<string, Namespace>>;

  constructor(input: MongoStorageInput<THash>) {
    super();
    this.storageHash = input.storageHash;
    this.collections = input.collections;
    this.namespaces = input.namespaces;
    freezeNode(this);
  }
}
