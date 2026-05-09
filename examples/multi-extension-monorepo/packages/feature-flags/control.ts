/**
 * Control-plane descriptor for the internal `feature-flags`
 * contract-space package. Same shape as the `audit` descriptor — the
 * point of this example is that the framework treats the two uniformly.
 *
 * **On-disk-in-package authoring.** See `../audit/control.ts` for the
 * convention; this file is the same pattern applied to the
 * feature-flags package.
 */

import { fileURLToPath } from 'node:url';
import type { Contract } from '@prisma-next/contract/types';
import type {
  ExtensionContractSpace,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import type { MigrationPackage } from '@prisma-next/migration-tools/package';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { FEATURE_FLAGS_BASELINE_MIGRATION_NAME, FEATURE_FLAGS_SPACE_ID } from './constants';
import contractJson from './contract.json' with { type: 'json' };
import baselineMetadata from './migrations/feature-flags/20260601T0000_create_feature_flag/migration.json' with {
  type: 'json',
};
import baselineOps from './migrations/feature-flags/20260601T0000_create_feature_flag/ops.json' with {
  type: 'json',
};
import headRef from './refs/head.json' with { type: 'json' };

function resolveMigrationDirPath(dirName: string): string {
  return fileURLToPath(
    new URL(`./migrations/${FEATURE_FLAGS_SPACE_ID}/${dirName}/`, import.meta.url),
  );
}

const baselinePackage: MigrationPackage = {
  dirName: FEATURE_FLAGS_BASELINE_MIGRATION_NAME,
  dirPath: resolveMigrationDirPath(FEATURE_FLAGS_BASELINE_MIGRATION_NAME),
  metadata: baselineMetadata as unknown as MigrationMetadata,
  ops: baselineOps as unknown as readonly MigrationPlanOperation[],
};

const featureFlagsContractSpace: ExtensionContractSpace = {
  contractJson: contractJson as unknown as Contract<SqlStorage>,
  migrations: [baselinePackage],
  headRef,
};

const featureFlagsExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: FEATURE_FLAGS_SPACE_ID,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  version: '0.0.1',
  contractSpace: featureFlagsContractSpace,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { featureFlagsExtensionDescriptor };
export default featureFlagsExtensionDescriptor;
