import type { StorageHashBase } from '@prisma-next/contract/types';
import { MongoStorageBase } from '@prisma-next/family-mongo/ir';
import type { Namespace } from '@prisma-next/framework-components/ir';
import type { MongoCollection } from '@prisma-next/mongo-contract';
import { MongoTargetUnspecifiedDatabase } from './mongo-target-database';

export interface MongoTargetStorageCtor {
  readonly storageHash: StorageHashBase<string>;
  readonly collections: Readonly<Record<string, MongoCollection>>;
  readonly namespaces?: Readonly<Record<string, Namespace>>;
}

/**
 * Mongo target storage concretion. Exercises the inheritance from the
 * family base meaningfully:
 *
 * - Inherits the family `namespaces` commitment from `MongoStorageBase`
 *   (every Mongo IR carries namespace-keyed storage).
 * - Adds `collections` and `storageHash` — the target-specific shape
 *   the family base intentionally does not commit to (collections are
 *   Mongo-target-shaped, not generic across the family).
 *
 * Default namespaces is `{ __unspecified__: MongoTargetUnspecifiedDatabase.instance }`
 * — all collections in a default contract live under the unspecified
 * singleton until per-collection namespace assignment lands.
 *
 * The on-disk JSON envelope omits `namespaces` (and any future
 * runtime-only class API field). The framework canonicalizer routes
 * through the per-target `ContractSerializer.serializeContract`
 * (`MongoTargetContractSerializer`) which constructs the persisted
 * JsonObject explicitly, so the storage class can declare runtime
 * fields freely without leaking them into emitted JSON.
 */
export class MongoTargetStorage extends MongoStorageBase {
  readonly storageHash: StorageHashBase<string>;
  readonly collections: Readonly<Record<string, MongoCollection>>;
  readonly namespaces: Readonly<Record<string, Namespace>>;

  constructor(options: MongoTargetStorageCtor) {
    super();
    this.storageHash = options.storageHash;
    this.collections = options.collections;
    this.namespaces =
      options.namespaces ??
      ({
        __unspecified__: MongoTargetUnspecifiedDatabase.instance,
      } as const);
    Object.freeze(this);
  }
}
