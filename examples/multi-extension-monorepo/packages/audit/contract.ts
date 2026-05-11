import { computeStorageHash } from '@prisma-next/contract/hashing';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { AUDIT_EVENT_TABLE } from './constants';

const TARGET = 'postgres' as const;
const TARGET_FAMILY = 'sql' as const;

const storageBody = {
  tables: {
    [AUDIT_EVENT_TABLE]: {
      columns: {
        id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
        actor: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
        action: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
      },
      primaryKey: { columns: ['id'] },
      uniques: [],
      indexes: [],
      foreignKeys: [],
    },
  },
};

export const AUDIT_STORAGE_HASH = computeStorageHash({
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  storage: storageBody,
});

export const auditContract: Contract<SqlStorage> = {
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  roots: {},
  models: {},
  capabilities: {},
  extensionPacks: {},
  meta: {},
  profileHash: profileHash('audit-extension-profile-v1'),
  storage: {
    ...storageBody,
    storageHash: coreHash(AUDIT_STORAGE_HASH),
  },
};
