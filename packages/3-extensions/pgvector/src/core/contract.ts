/**
 * pgvector contract space — declares the parameterised native type
 * `vector(N)` that user columns can name as `nativeType`.
 *
 * Unlike CipherStash's typed objects (composite types / domains / enums
 * — deferred behind `meta.cipherstashFutureIR` until the IR vocabulary
 * gains first-class support), pgvector's `vector` is a parameterised
 * native type and *is* representable in today's IR via
 * {@link StorageTypeInstance}: `{ codecId, nativeType, typeParams }`.
 * The contract registers a representative instance under
 * `storage.types.vector` so the verifier sees the type as part of
 * pgvector's space contribution and so the pinned `contract.json` on
 * disk is materially distinct from an empty space.
 *
 * Per-column instances on the user's side carry concrete
 * `typeParams.length` (e.g. `vector(1536)`); the registration here
 * declares the parameterised shape — it is not consumed as a literal
 * column type by any user table.
 */

import { computeStorageHash } from '@prisma-next/contract/hashing';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { VECTOR_CODEC_ID } from './constants';
import { PGVECTOR_NATIVE_TYPE } from './contract-space-constants';

const TARGET = 'postgres' as const;
const TARGET_FAMILY = 'sql' as const;

/**
 * Storage body for the contract — pgvector ships no tables of its own;
 * the `vector` parameterised native type is registered under
 * `storage.types` so pgvector's IR contribution is non-empty and the
 * pinned `contract.json` on disk differs materially from an empty
 * extension space.
 *
 * Authored without `storageHash` here so {@link computeStorageHash} can
 * digest the canonical body (the hashing pipeline panics if asked to
 * hash an object that already carries its own output — see
 * `assertDescriptorSelfConsistency`'s storage-hash strip).
 */
const storageBody = {
  tables: {},
  types: {
    [PGVECTOR_NATIVE_TYPE]: {
      codecId: VECTOR_CODEC_ID,
      nativeType: PGVECTOR_NATIVE_TYPE,
      typeParams: {},
    },
  },
};

/** Content-addressed hash of pgvector's storage IR. */
export const PGVECTOR_STORAGE_HASH = computeStorageHash({
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  storage: storageBody,
});

/** pgvector's contract value, exposed via the descriptor's `contractSpace.contractJson`. */
export const pgvectorContract: Contract<SqlStorage> = {
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  roots: {},
  models: {},
  capabilities: {},
  extensionPacks: {},
  meta: {},
  profileHash: profileHash('pgvector-extension-profile-v1'),
  storage: {
    ...storageBody,
    storageHash: coreHash(PGVECTOR_STORAGE_HASH),
  },
};
