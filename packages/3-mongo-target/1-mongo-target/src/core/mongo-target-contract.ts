import type { Contract } from '@prisma-next/contract/types';
import type { MongoStorage } from '@prisma-next/mongo-contract';

/**
 * Mongo target contract envelope: the result of
 * `descriptor.contractSerializer.deserializeContract(json)`.
 *
 * Structurally a {@link Contract} with the storage envelope promoted to
 * the family-layer {@link MongoStorage} class instance — namespace keys live
 * alongside `storageHash` on that class. The leaf collection / index shapes
 * inside each namespace's `collections` are family-layer `MongoCollection` instances.
 */
export type MongoTargetContract = Contract<MongoStorage>;
