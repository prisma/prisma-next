import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { TEST_BOX_TABLE, TEST_HEAD_HASH } from './constants';

/**
 * The contract value the synthetic test extension publishes through its
 * descriptor. Declares a single `test_box` table with two integer columns
 * — the simplest non-empty schema representable in today's SQL contract
 * IR. Future IR work (composite types, enums, domains) can swap this for
 * a richer fixture without changing the descriptor wiring.
 */
export const testContractSpaceContract: Contract<SqlStorage> = {
  target: 'postgres',
  targetFamily: 'sql',
  roots: {},
  models: {},
  capabilities: {},
  extensionPacks: {},
  meta: {},
  profileHash: profileHash('synthetic-test-contract-space-profile-v1'),
  storage: {
    storageHash: coreHash(TEST_HEAD_HASH),
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
  },
};
