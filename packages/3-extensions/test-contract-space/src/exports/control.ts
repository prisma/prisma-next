/**
 * Control-plane descriptor for the synthetic test extension.
 *
 * **Reference model — on-disk-in-package authoring.**
 *
 * The extension's contract + migrations are emitted by the same
 * pipeline application authors use:
 *
 *   `prisma-next contract emit` → `<package>/contract.{json,d.ts}`
 *   `prisma-next migration plan` → `<package>/migrations/<space-id>/<dir>/...`
 *
 * The descriptor wires those JSON artefacts via JSON-import declarations
 * so they flow through the consuming application's module resolver
 * without filesystem assumptions, and synthesises the canonical
 * {@link import('@prisma-next/migration-tools/package').MigrationPackage}
 * shape (gaining `dirPath` from `import.meta.url`) for the framework's
 * runner / verifier to consume.
 *
 * The descriptor lives behind `./control` mirroring real extension
 * packages (cipherstash, pgvector), so integration tests load it via
 * the same module-graph `import` path a real extension descriptor
 * would flow through.
 *
 * @see docs/architecture docs/adrs/ADR 211 - Contract spaces.md
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
import contractJson from '../../contract.json' with { type: 'json' };
import baselineMetadata from '../../migrations/test-contract-space/20260101T0000_baseline/migration.json' with {
  type: 'json',
};
import baselineOps from '../../migrations/test-contract-space/20260101T0000_baseline/ops.json' with {
  type: 'json',
};
import headRef from '../../refs/head.json' with { type: 'json' };
import { TEST_SPACE_ID } from '../core/constants';

const BASELINE_DIR_NAME = '20260101T0000_baseline';

/**
 * Resolve a migration package's on-disk path from this descriptor module's
 * URL. The framework's runner uses `dirPath` for diagnostic messages and
 * to locate sibling files (e.g. `start-contract.json` for non-baseline
 * migrations); pinning it from `import.meta.url` keeps the value correct
 * regardless of where the consuming application installs the package
 * (workspace, node_modules, bundled, etc.).
 */
function resolveMigrationDirPath(dirName: string): string {
  return fileURLToPath(new URL(`../../migrations/${TEST_SPACE_ID}/${dirName}/`, import.meta.url));
}

// JSON-imported values lose the workspace's branded types
// (e.g. `StorageHashBase<string>`, `MigrationPlanOperation` discriminants),
// so we cast through `unknown` here. The values themselves are the same
// canonical artefacts the application's contract / migration runners
// produce and re-validate at runtime — the descriptor is just a pass-through
// wiring layer between the on-disk JSON and the framework's typed surface.
const baselinePackage: MigrationPackage = {
  dirName: BASELINE_DIR_NAME,
  dirPath: resolveMigrationDirPath(BASELINE_DIR_NAME),
  metadata: baselineMetadata as unknown as MigrationMetadata,
  ops: baselineOps as unknown as readonly MigrationPlanOperation[],
};

const testContractSpace: ExtensionContractSpace = {
  contractJson: contractJson as unknown as Contract<SqlStorage>,
  migrations: [baselinePackage],
  headRef,
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
