import type { StorageHashBase } from '@prisma-next/contract/types';
import type { Namespace } from '@prisma-next/framework-components/ir';
import type { MongoStorageCollection } from '@prisma-next/mongo-contract';
import { MongoStorageBase } from '@prisma-next/mongo-contract/ir';
import { MongoTargetUnspecifiedDatabase } from './mongo-target-database';

export interface MongoTargetStorageCtor {
  readonly storageHash: StorageHashBase<string>;
  readonly collections: Readonly<Record<string, MongoStorageCollection>>;
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
 * The leaf `collections` entries remain in their existing flat-data
 * shape this round; the IR-node class flip (`MongoIndex`,
 * `MongoIndexOptions`, …) lands in M2 R2. The storage envelope itself
 * is a class instance from this commit on — that's what the SPI
 * `descriptor.contractSerializer.deserializeContract` boundary now
 * promises.
 *
 * Default namespaces is `{ __unspecified__: MongoTargetUnspecifiedDatabase.instance }`
 * — all collections in a default contract live under the unspecified
 * singleton until M5a introduces per-collection namespace assignment.
 */
export class MongoTargetStorage extends MongoStorageBase {
  readonly storageHash: StorageHashBase<string>;
  readonly collections: Readonly<Record<string, MongoStorageCollection>>;
  readonly namespaces: Readonly<Record<string, Namespace>>;

  constructor(options: MongoTargetStorageCtor) {
    super();
    this.storageHash = options.storageHash;
    this.collections = options.collections;
    this.namespaces = options.namespaces ?? {
      __unspecified__: MongoTargetUnspecifiedDatabase.instance,
    };
    Object.freeze(this);
  }
}
