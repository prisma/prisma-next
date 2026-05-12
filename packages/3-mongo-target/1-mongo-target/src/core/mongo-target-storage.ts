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

  // `namespaces` is part of the class API (every IR carries namespaces —
  // see Storage / MongoStorageBase) but is intentionally NOT part of the
  // on-disk JSON envelope. Holding it through a non-enumerable property
  // keeps `JSON.stringify(storage)` and `Object.entries(storage)` (the
  // path `canonicalizeContractToObject` walks during emission) free of
  // the runtime-only field, while preserving direct property access.
  // The IR-node class flip in M2 R2 will keep this same convention for
  // class-internal hooks.
  readonly namespaces!: Readonly<Record<string, Namespace>>;

  constructor(options: MongoTargetStorageCtor) {
    super();
    this.storageHash = options.storageHash;
    this.collections = options.collections;
    Object.defineProperty(this, 'namespaces', {
      value:
        options.namespaces ??
        ({
          __unspecified__: MongoTargetUnspecifiedDatabase.instance,
        } as const),
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.freeze(this);
  }
}
