/**
 * Control-plane descriptor for the synthetic test extension.
 *
 * Exposes a `contractSpace` so the framework's per-space planner / runner /
 * verifier (project: extension-contract-spaces, M1) can be exercised
 * end-to-end against a real workspace package — without taking on the
 * baggage (vendored bundle SQL, codec hooks, native extension installs)
 * that real consumers like cipherstash or pgvector carry.
 *
 * The descriptor lives behind `./control` mirroring pgvector's package
 * shape, so integration tests load it via the same module-graph
 * `import` path a real extension descriptor would flow through.
 */

import type {
  ExtensionContractSpace,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import { TEST_SPACE_ID } from '../core/constants';
import { testContractSpaceContract } from '../core/contract';
import { testContractSpaceBaselineMigration, testContractSpaceHeadRef } from '../core/migrations';

const testContractSpace: ExtensionContractSpace = {
  contractJson: testContractSpaceContract,
  migrations: [testContractSpaceBaselineMigration],
  headRef: testContractSpaceHeadRef,
};

const testContractSpaceExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: TEST_SPACE_ID,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  version: '0.0.1',
  contractSpace: testContractSpace,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { testContractSpaceExtensionDescriptor };
export default testContractSpaceExtensionDescriptor;
