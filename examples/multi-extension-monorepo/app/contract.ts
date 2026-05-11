/**
 * Application contract for the multi-extension-monorepo example.
 *
 * Declares one user-owned `User` table, completely independent of the
 * tables contributed by the two internal extension packages
 * (`audit_event` from `packages/audit`, `feature_flag` from
 * `packages/feature-flags`). After `migrate` + `apply` runs against a
 * fresh database, all three tables coexist in `public`, and the marker
 * table holds three rows — one per contract space.
 */

import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';

export const APP_USER_TABLE = 'app_user' as const;

const APP_CONTRACT_HASH = coreHash('sha256:multi-extension-monorepo-app-v1');
const APP_PROFILE_HASH = profileHash('sha256:multi-extension-monorepo-app-profile-v1');

export const appContract: Contract<SqlStorage> = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: APP_PROFILE_HASH,
  storage: {
    storageHash: APP_CONTRACT_HASH,
    tables: {
      [APP_USER_TABLE]: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    },
  },
  roots: {},
  models: {},
  capabilities: {},
  extensionPacks: {},
  meta: {},
};

export const APP_CONTRACT_HASH_VALUE = APP_CONTRACT_HASH;
