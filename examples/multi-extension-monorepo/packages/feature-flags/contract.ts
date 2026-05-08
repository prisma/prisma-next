import { computeStorageHash } from '@prisma-next/contract/hashing';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { FEATURE_FLAG_TABLE } from './constants';

const TARGET = 'postgres' as const;
const TARGET_FAMILY = 'sql' as const;

const storageBody = {
  tables: {
    [FEATURE_FLAG_TABLE]: {
      columns: {
        key: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
        enabled: { codecId: 'pg/bool@1', nativeType: 'boolean', nullable: false },
      },
      primaryKey: { columns: ['key'] },
      uniques: [],
      indexes: [],
      foreignKeys: [],
    },
  },
};

export const FEATURE_FLAGS_STORAGE_HASH = computeStorageHash({
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  storage: storageBody,
});

export const featureFlagsContract: Contract<SqlStorage> = {
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  roots: {},
  models: {},
  capabilities: {},
  extensionPacks: {},
  meta: {},
  profileHash: profileHash('feature-flags-extension-profile-v1'),
  storage: {
    ...storageBody,
    storageHash: coreHash(FEATURE_FLAGS_STORAGE_HASH),
  },
};
