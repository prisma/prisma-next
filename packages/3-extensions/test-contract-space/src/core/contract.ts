import { computeStorageHash } from '@prisma-next/contract/hashing';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { TEST_BOX_TABLE } from './constants';

const TARGET = 'postgres' as const;
const TARGET_FAMILY = 'sql' as const;

const storageBody = {
  tables: {
    [TEST_BOX_TABLE]: {
      columns: {
        x: { codecId: 'pg/int4@1', nativeType: 'integer', nullable: false },
        y: { codecId: 'pg/int4@1', nativeType: 'integer', nullable: false },
      },
      uniques: [],
      indexes: [],
      foreignKeys: [],
    },
  },
};

/**
 * Content-addressed hash of the synthetic test extension's storage IR.
 * Computed via the same `computeStorageHash` the production emit pipeline
 * uses, so the descriptor self-consistency check (M2 R2) and the runner's
 * marker writes (later) see the same value the framework would compute
 * for any real extension.
 */
export const TEST_HEAD_HASH = computeStorageHash({
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  storage: storageBody,
});

/**
 * The contract value the synthetic test extension publishes through its
 * descriptor. Declares a single `test_box` table with two integer columns
 * — the simplest non-empty schema representable in today's SQL contract
 * IR. Future IR work (composite types, enums, domains) can swap this for
 * a richer fixture without changing the descriptor wiring.
 */
export const testContractSpaceContract: Contract<SqlStorage> = {
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  roots: {},
  models: {},
  capabilities: {},
  extensionPacks: {},
  meta: {},
  profileHash: profileHash('synthetic-test-contract-space-profile-v1'),
  storage: {
    ...storageBody,
    storageHash: coreHash(TEST_HEAD_HASH),
  },
};
