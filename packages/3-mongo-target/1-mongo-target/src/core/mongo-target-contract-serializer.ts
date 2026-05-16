import { MongoContractSerializerBase } from '@prisma-next/family-mongo/ir';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { type MongoContract, MongoStorage } from '@prisma-next/mongo-contract';
import type { JsonObject } from '@prisma-next/utils/json';
import type { MongoTargetContract } from './mongo-target-contract';
import { MongoTargetUnboundDatabase } from './mongo-target-database';

/**
 * Mongo target `ContractSerializer` concretion. Plugs into the
 * family-shared deserialization pipeline at `constructTargetContract`,
 * wrapping the validated flat-data shape in a `MongoStorage` class
 * instance and providing the target's default namespace map.
 *
 * Default namespaces is
 * `{ [UNBOUND_NAMESPACE_ID]: MongoTargetUnboundDatabase.instance }`
 * — supplied at this target-layer call site because the family-layer
 * `MongoStorage` class is target-agnostic (it cannot import the
 * Mongo-target's namespace concretion). Contracts authored before
 * multi-namespace support bind to the unbound singleton without the
 * call site declaring anything.
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
    const targetStorage = new MongoStorage({
      storageHash: storage.storageHash,
      collections: storage.collections,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: MongoTargetUnboundDatabase.instance,
      },
    });
    return { ...rest, storage: targetStorage };
  }

  /**
   * Produce the canonical on-disk JSON shape from an in-memory Mongo
   * contract. Strips runtime-only fields the storage class carries
   * for its live-instance API but that don't belong in the persisted
   * envelope: `MongoStorage.namespaces` is a Namespace-class map the
   * verifier and runtime walk; the persisted shape omits it (today's
   * contracts have a single implicit unbound namespace; future
   * explicit per-collection assignment will surface in JSON via a
   * different field).
   *
   * Constructing the JsonObject here — rather than relying on
   * non-enumerable property tricks at the storage class — keeps the
   * "what's on disk" decision in the SPI implementer, where it
   * belongs.
   */
  override serializeContract(contract: MongoTargetContract): JsonObject {
    const { storage, ...rest } = contract;
    // `as unknown as JsonObject` because the returned literal mixes
    // `MongoCollection` class instances under `storage.collections` with
    // the JSON-clean remainder of the contract envelope. The class
    // instances are JSON-clean by construction (their `kind` literal is
    // enumerable; nested IR shapes are normalised by the constructor),
    // so the canonical-stringify pass produces correct output, but the
    // structural type system doesn't know `MongoCollection` is JSON-safe.
    return {
      ...rest,
      storage: {
        storageHash: storage.storageHash,
        collections: storage.collections,
      },
    } as unknown as JsonObject;
  }
}
