import type { MongoContract } from '@prisma-next/mongo-contract';
import type { MongoTargetStorage } from './mongo-target-storage';

/**
 * Mongo target contract envelope: the result of
 * `descriptor.contractSerializer.deserializeContract(json)`.
 *
 * This is structurally `MongoContract` with the storage envelope
 * promoted to the `MongoTargetStorage` class instance — the class
 * carries `namespaces` and gives the rest of the framework a stable
 * surface to reach for. The leaf collection / index shapes inside
 * `storage.collections` remain flat-data this round; the IR-node class
 * flip lands in M2 R2.
 */
export type MongoTargetContract = Omit<MongoContract, 'storage'> & {
  readonly storage: MongoTargetStorage;
};
