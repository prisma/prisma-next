/**
 * Control-plane descriptor for the internal `feature-flags`
 * contract-space package. Same shape as the `audit` descriptor — the
 * point of this example is that the framework treats the two
 * uniformly.
 */

import type {
  ExtensionContractSpace,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import { FEATURE_FLAGS_SPACE_ID } from './constants';
import { featureFlagsContract } from './contract';
import { featureFlagsBaselineMigration, featureFlagsHeadRef } from './migrations';

const featureFlagsContractSpace: ExtensionContractSpace = {
  contractJson: featureFlagsContract,
  migrations: [featureFlagsBaselineMigration],
  headRef: featureFlagsHeadRef,
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
