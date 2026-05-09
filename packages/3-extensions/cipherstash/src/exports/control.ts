/**
 * Control-plane descriptor for the CipherStash extension.
 *
 * **On-disk-in-package authoring (M3.5 R2).** The extension's contract
 * + migrations are emitted by the same pipeline application authors use:
 *
 *   `prisma-next contract emit` → `<package>/contract.{json,d.ts}`
 *   `prisma-next migration plan` → `<package>/migrations/cipherstash/<dir>/...`
 *
 * The descriptor wires those JSON artefacts via JSON-import declarations
 * so they flow through the consuming application's module resolver
 * without filesystem assumptions, and synthesises the canonical
 * {@link import('@prisma-next/migration-tools/package').MigrationPackage}
 * shape (gaining `dirPath` from `import.meta.url`) for the framework's
 * runner / verifier to consume.
 *
 * Wired surfaces:
 *
 *   - `contractSpace.{contractJson,migrations,headRef}` — sourced from
 *     the on-disk artefacts emitted by `build:contract-space`.
 *   - `types.codecTypes.controlPlaneHooks[CIPHERSTASH_STRING_CODEC_ID]`
 *     — the lifecycle hook the SQL planner extracts via
 *     `extractCodecControlHooks` and inlines into the application's
 *     migration via `planFieldEventOperations` (sub-spec § 5).
 *     Implements `add_search_config` / `remove_search_config` /
 *     rotate behaviour for `searchable: true` `Encrypted<string>`
 *     columns.
 *
 * @see docs/architecture docs/adrs/ADR 211 - Contract spaces.md
 *   (on-disk-in-package authoring convention).
 * @see packages/3-extensions/test-contract-space/src/exports/control.ts
 *   (R1 reference model).
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
import baselineMetadata from '../../migrations/cipherstash/20260601T0000_install_eql_bundle/migration.json' with {
  type: 'json',
};
import baselineOps from '../../migrations/cipherstash/20260601T0000_install_eql_bundle/ops.json' with {
  type: 'json',
};
import headRef from '../../migrations/cipherstash/refs/head.json' with { type: 'json' };
import {
  CIPHERSTASH_BASELINE_MIGRATION_NAME,
  CIPHERSTASH_SPACE_ID,
  CIPHERSTASH_STRING_CODEC_ID,
} from '../extension-metadata/constants';
import { cipherstashPackMeta } from '../extension-metadata/descriptor-meta';
import { cipherstashStringCodecHooks } from '../migration/cipherstash-codec';

/**
 * Resolve a migration package's on-disk path from this descriptor module's
 * URL. The framework's runner uses `dirPath` for diagnostic messages and
 * to locate sibling files (e.g. `start-contract.json` for non-baseline
 * migrations); pinning it from `import.meta.url` keeps the value correct
 * regardless of where the consuming application installs the package
 * (workspace, node_modules, bundled, etc.).
 */
function resolveMigrationDirPath(dirName: string): string {
  return fileURLToPath(
    new URL(`../../migrations/${CIPHERSTASH_SPACE_ID}/${dirName}/`, import.meta.url),
  );
}

const baselinePackage: MigrationPackage = {
  dirName: CIPHERSTASH_BASELINE_MIGRATION_NAME,
  dirPath: resolveMigrationDirPath(CIPHERSTASH_BASELINE_MIGRATION_NAME),
  metadata: baselineMetadata as unknown as MigrationMetadata,
  ops: baselineOps as unknown as readonly MigrationPlanOperation[],
};

const cipherstashContractSpace: ExtensionContractSpace = {
  contractJson: contractJson as unknown as Contract<SqlStorage>,
  migrations: [baselinePackage],
  headRef,
};

const cipherstashExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  // Spread pack-meta first so it contributes `kind` / `id` / `familyId`
  // / `targetId` / `version` / `authoring` / `types.{codecTypes,storage}`
  // — then overlay the contract-space block (TML-2397) and the codec
  // lifecycle hook (TML-2397) on top. The two `types.codecTypes` slots
  // (`codecInstances` from pack-meta, `controlPlaneHooks` from this
  // descriptor) coexist on the same path and are merged below.
  ...cipherstashPackMeta,
  contractSpace: cipherstashContractSpace,
  /**
   * Free-form `types.codecTypes.controlPlaneHooks` block — the SQL
   * family's `extractCodecControlHooks` (in `@prisma-next/family-sql/
   * control`) finds hooks via duck-typing on this exact path. Mirrors
   * pgvector's wiring at `packages/3-extensions/pgvector/src/exports/
   * control.ts`.
   */
  types: {
    ...cipherstashPackMeta.types,
    codecTypes: {
      ...cipherstashPackMeta.types.codecTypes,
      controlPlaneHooks: {
        [CIPHERSTASH_STRING_CODEC_ID]: cipherstashStringCodecHooks,
      },
    },
  },
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { cipherstashExtensionDescriptor };
export default cipherstashExtensionDescriptor;
