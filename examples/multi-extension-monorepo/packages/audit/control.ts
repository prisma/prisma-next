/**
 * Control-plane descriptor for the internal `audit` contract-space
 * package.
 *
 * **On-disk-in-package authoring (M3.5 R3).** The package's contract +
 * migrations are emitted by the same pipeline application authors use:
 *
 *   `prisma-next contract emit` → `<package>/contract.{json,d.ts}`
 *   `prisma-next migration plan` → `<package>/migrations/audit/<dir>/...`
 *
 * The descriptor wires those JSON artefacts via JSON-import declarations
 * so they flow through the consuming application's module resolver, and
 * synthesises the canonical
 * {@link import('@prisma-next/migration-tools/package').MigrationPackage}
 * shape (gaining `dirPath` from `import.meta.url`) for the framework's
 * runner / verifier to consume.
 *
 * @see docs/architecture docs/adrs/ADR 211 - Contract spaces.md
 *   (on-disk-in-package authoring convention).
 * @see packages/3-extensions/cipherstash/src/exports/control.ts
 *   (R2 reference model — first real extension to adopt the convention).
 */

import { fileURLToPath } from 'node:url';
import type { Contract } from '@prisma-next/contract/types';
import type { SqlControlExtensionDescriptor } from '@prisma-next/family-sql/control';
import type {
  ContractSpace,
  MigrationPlanOperation,
} from '@prisma-next/framework-components/control';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import type { MigrationPackage } from '@prisma-next/migration-tools/package';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { AUDIT_BASELINE_MIGRATION_NAME, AUDIT_SPACE_ID } from './constants';
import contractJson from './contract.json' with { type: 'json' };
import baselineMetadata from './migrations/audit/20260601T0000_create_audit_event/migration.json' with {
  type: 'json',
};
import baselineOps from './migrations/audit/20260601T0000_create_audit_event/ops.json' with {
  type: 'json',
};
import headRef from './refs/head.json' with { type: 'json' };

function resolveMigrationDirPath(dirName: string): string {
  return fileURLToPath(new URL(`./migrations/${AUDIT_SPACE_ID}/${dirName}/`, import.meta.url));
}

// JSON-imported values lose the workspace's branded types, so we cast
// through `unknown` here. The values are the same canonical artefacts
// the application's contract / migration runners produce and re-validate
// at runtime — this descriptor is just a pass-through wiring layer.
const baselinePackage: MigrationPackage = {
  dirName: AUDIT_BASELINE_MIGRATION_NAME,
  dirPath: resolveMigrationDirPath(AUDIT_BASELINE_MIGRATION_NAME),
  metadata: baselineMetadata as unknown as MigrationMetadata,
  ops: baselineOps as unknown as readonly MigrationPlanOperation[],
};

const auditContractSpace: ContractSpace<Contract<SqlStorage>> = {
  contractJson: contractJson as unknown as Contract<SqlStorage>,
  migrations: [baselinePackage],
  headRef,
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
