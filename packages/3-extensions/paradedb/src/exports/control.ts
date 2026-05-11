/**
 * Control-plane descriptor for the paradedb extension.
 *
 * **On-disk-in-package authoring.** The extension's contract
 * + migrations are emitted by the same pipeline application authors use:
 *
 *   `prisma-next contract emit` → `<package>/contract.{json,d.ts}`
 *   `prisma-next migration plan` → `<package>/migrations/paradedb/<dir>/...`
 *
 * The descriptor wires those JSON artefacts via JSON-import declarations
 * so they flow through the consuming application's module resolver
 * without filesystem assumptions, and synthesises the canonical
 * {@link import('@prisma-next/framework-components/control').MigrationPackage}
 * shape for the framework's runner / verifier to consume. Readers in
 * `@prisma-next/migration-tools` add `dirPath` when loading from disk
 * (`OnDiskMigrationPackage`); descriptor-bundled packages do not need
 * it because the framework reads them directly from the descriptor.
 *
 * Wired surfaces:
 *
 *   - `contractSpace.{contractJson,migrations,headRef}` — sourced from
 *     the on-disk artefacts emitted by `build:contract-space`.
 *   - `queryOperations` — BM25 full-text search operations registered
 *     via `paradedbQueryOperations()`.
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 *   (on-disk-in-package authoring convention).
 * @see packages/3-extensions/test-contract-space/src/exports/control.ts
 *   (reference model).
 */

import type { Contract } from '@prisma-next/contract/types';
import type { SqlControlExtensionDescriptor } from '@prisma-next/family-sql/control';
import type {
  ContractSpace,
  MigrationPackage,
  MigrationPlanOperation,
} from '@prisma-next/framework-components/control';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import contractJson from '../../contract.json' with { type: 'json' };
import baselineMetadata from '../../migrations/paradedb/20260601T0000_install_pg_search_extension/migration.json' with {
  type: 'json',
};
import baselineOps from '../../migrations/paradedb/20260601T0000_install_pg_search_extension/ops.json' with {
  type: 'json',
};
import headRef from '../../refs/head.json' with { type: 'json' };
import { PARADEDB_SPACE_ID } from '../core/constants';
import { paradedbPackMeta, paradedbQueryOperations } from '../core/descriptor-meta';

const BASELINE_DIR_NAME = '20260601T0000_install_pg_search_extension';

// JSON-imported values lose the workspace's branded types
// (e.g. `StorageHashBase<string>`, `MigrationPlanOperation` discriminants),
// so we cast through `unknown` here. The values themselves are the same
// canonical artefacts the application's contract / migration runners
// produce and re-validate at runtime — the descriptor is just a
// pass-through wiring layer between the on-disk JSON and the framework's
// typed surface.
const baselinePackage: MigrationPackage = {
  dirName: BASELINE_DIR_NAME,
  metadata: baselineMetadata as unknown as MigrationMetadata,
  ops: baselineOps as unknown as readonly MigrationPlanOperation[],
};

const paradedbContractSpace: ContractSpace<Contract<SqlStorage>> = {
  contractJson: contractJson as unknown as Contract<SqlStorage>,
  migrations: [baselinePackage],
  headRef,
};

const paradedbExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  ...paradedbPackMeta,
  id: PARADEDB_SPACE_ID,
  contractSpace: paradedbContractSpace,
  queryOperations: () => paradedbQueryOperations(),
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { paradedbExtensionDescriptor, paradedbPackMeta };
export default paradedbExtensionDescriptor;
