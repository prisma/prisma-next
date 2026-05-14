import { MongoContractSerializerBase } from '@prisma-next/family-mongo/ir';
import type { MongoContract } from '@prisma-next/mongo-contract';
import type { JsonObject } from '@prisma-next/utils/json';
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
 * `validated.storage.collections` already carries `MongoCollection` IR
 * class instances by the time this method runs — the family-base
 * `hydrateMongoContract` walks the arktype-validated tree and
 * constructs class instances before validation. The target serializer
 * just wraps the envelope.
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

  /**
   * Produce the canonical on-disk JSON shape from an in-memory Mongo
   * contract. Strips runtime-only fields the storage class carries
   * for its live-instance API but that don't belong in the persisted
   * envelope: `MongoTargetStorage.namespaces` is a Namespace-class
   * map the verifier and runtime walk; the persisted shape omits it
   * (today's contracts have a single implicit `__unspecified__`
   * namespace; M5a introduces explicit per-collection assignment
   * which will surface in JSON via a different field).
   *
   * Constructing the JsonObject here — rather than relying on
   * non-enumerable property tricks at the storage class — keeps the
   * "what's on disk" decision in the SPI implementer, where it
   * belongs.
   */
  override serializeContract(contract: MongoTargetContract): JsonObject {
    const { storage, ...rest } = contract;
    return {
      ...rest,
      storage: {
        storageHash: storage.storageHash,
        collections: storage.collections,
      },
    } as unknown as JsonObject;
  }
}
