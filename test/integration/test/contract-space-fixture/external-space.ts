/**
 * All-external variant of the synthetic test extension: a contract space
 * that pins a head ref but ships NO migration packages, mirroring
 * `@prisma-next/extension-supabase` (its `auth`/`storage` tables are
 * `external`, so the space emits no DDL and has nothing to author).
 * Exercises the declarative marker advancement path in `migrate`.
 */

import { computeStorageHash } from '@prisma-next/contract/hashing';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlControlExtensionDescriptor } from '@prisma-next/family-sql/control';
import type { ContractSpace } from '@prisma-next/framework-components/control';
import { sqlContractCanonicalizationHooks } from '@prisma-next/sql-contract/canonicalization-hooks';
import { SqlStorage } from '@prisma-next/sql-contract/types';
import { postgresCreateNamespace } from '@prisma-next/target-postgres/types';

const TARGET = 'postgres' as const;
const TARGET_FAMILY = 'sql' as const;

export const TEST_EXTERNAL_SPACE_ID = 'test-external-space';

const storageBody = {
  namespaces: {
    ext_platform: {
      id: 'ext_platform',
      entries: {
        table: {
          platform_users: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    },
  },
};

export const TEST_EXTERNAL_HEAD_HASH = computeStorageHash({
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  storage: storageBody,
  ...sqlContractCanonicalizationHooks,
});

const testExternalSpaceContract: Contract<SqlStorage> = {
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  roots: {},
  domain: {
    namespaces: {
      ext_platform: {
        models: {},
      },
    },
  },
  capabilities: {},
  extensionPacks: {},
  meta: {},
  profileHash: profileHash('synthetic-test-external-space-profile-v1'),
  storage: new SqlStorage({
    storageHash: coreHash(TEST_EXTERNAL_HEAD_HASH),
    namespaces: {
      ext_platform: postgresCreateNamespace(storageBody.namespaces.ext_platform),
    },
  }),
};

const testExternalSpace: ContractSpace<Contract<SqlStorage>> = {
  contractJson: testExternalSpaceContract,
  migrations: [],
  headRef: { hash: TEST_EXTERNAL_HEAD_HASH, invariants: [] },
};

const testExternalSpaceExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: TEST_EXTERNAL_SPACE_ID,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  version: '0.0.1',
  contractSpace: testExternalSpace,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { testExternalSpaceExtensionDescriptor };
export default testExternalSpaceExtensionDescriptor;
