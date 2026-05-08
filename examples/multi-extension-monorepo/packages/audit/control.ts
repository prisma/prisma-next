/**
 * Control-plane descriptor for the internal `audit` contract-space
 * package. Exposes a `contractSpace` so the framework treats the
 * audit-event scaffolding as a first-class schema contribution
 * alongside the application's own schema.
 */

import type {
  ExtensionContractSpace,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import { AUDIT_SPACE_ID } from './constants';
import { auditContract } from './contract';
import { auditBaselineMigration, auditHeadRef } from './migrations';

const auditContractSpace: ExtensionContractSpace = {
  contractJson: auditContract,
  migrations: [auditBaselineMigration],
  headRef: auditHeadRef,
};

const auditExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: AUDIT_SPACE_ID,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  version: '0.0.1',
  contractSpace: auditContractSpace,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { auditExtensionDescriptor };
export default auditExtensionDescriptor;
