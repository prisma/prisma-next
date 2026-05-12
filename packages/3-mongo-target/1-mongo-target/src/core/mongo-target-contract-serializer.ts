import type { MongoContract } from '@prisma-next/mongo-contract';
import { MongoContractSerializerBase } from '@prisma-next/mongo-contract/ir';
import type { MongoTargetContract } from './mongo-target-contract';
import { MongoTargetStorage } from './mongo-target-storage';

/**
 * Mongo target `ContractSerializer` concretion. Plugs into the
 * family-shared deserialization pipeline at `constructTargetContract`,
 * wrapping the validated flat-data shape in a `MongoTargetStorage`
 * class instance.
 *
 * The class instance carries the family-promised `namespaces` field;
 * default namespaces is `{ __unspecified__: MongoTargetUnspecifiedDatabase.instance }`
 * (the storage class's own default), so contracts authored before
 * multi-namespace support (M5a) bind to the unspecified singleton
 * without the call site declaring anything.
 *
 * Leaf shapes (collections, indexes, validators, options) remain in
 * their existing flat-data shape this round; the IR-node class flip
 * lands in M2 R2.
 */
export class MongoTargetContractSerializer extends MongoContractSerializerBase<MongoTargetContract> {
  protected constructTargetContract(validated: MongoContract): MongoTargetContract {
    const { storage, ...rest } = validated;
    const targetStorage = new MongoTargetStorage({
      storageHash: storage.storageHash,
      collections: storage.collections,
    });
    return { ...rest, storage: targetStorage };
  }
}
