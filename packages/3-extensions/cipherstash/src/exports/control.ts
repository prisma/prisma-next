/**
 * Control-plane descriptor for the CipherStash extension.
 *
 * **Contract-space package layout.** The extension's contract +
 * migrations are emitted by the same pipeline application authors use:
 *
 *   `prisma-next contract emit` → `<package>/src/contract.{json,d.ts}`
 *   `prisma-next migration plan` → `<package>/migrations/<dir>/...`
 *
 * The descriptor wires those JSON artefacts via JSON-import declarations
 * so they flow through the consuming application's module resolver
 * without filesystem assumptions, and synthesises the canonical
 * {@link import('@prisma-next/framework-components/control').MigrationPackage}
 * shape for the framework's runner / verifier to consume.
 *
 * Wired surfaces:
 *
 *   - `contractSpace.{contractJson,migrations,headRef}` — sourced from
 *     the on-disk artefacts emitted by `build:contract-space`.
 *   - `types.codecTypes.controlPlaneHooks[CIPHERSTASH_STRING_CODEC_ID]`
 *     — the lifecycle hook the SQL planner extracts via
 *     `extractCodecControlHooks` and inlines into the application's
 *     migration via `planFieldEventOperations`. Implements
 *     `add_search_config` / `remove_search_config` / rotate behaviour
 *     for `searchable: true` `Encrypted<string>` columns.
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 *   (contract-space package layout convention).
 */

import type { Contract } from '@prisma-next/contract/types';
import type { SqlControlExtensionDescriptor } from '@prisma-next/family-sql/control';
import { contractSpaceFromJson } from '@prisma-next/migration-tools/spaces';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import baselineMetadata from '../../migrations/20260601T0000_install_eql_bundle/migration.json' with {
  type: 'json',
};
import baselineOps from '../../migrations/20260601T0000_install_eql_bundle/ops.json' with {
  type: 'json',
};
import headRef from '../../migrations/refs/head.json' with { type: 'json' };
import contractJson from '../contract.json' with { type: 'json' };
import {
  CIPHERSTASH_BASELINE_MIGRATION_NAME,
  CIPHERSTASH_STRING_CODEC_ID,
} from '../extension-metadata/constants';
import { cipherstashPackMeta } from '../extension-metadata/descriptor-meta';
import { cipherstashStringCodecHooks } from '../migration/cipherstash-codec';

const cipherstashContractSpace = contractSpaceFromJson<Contract<SqlStorage>>({
  contractJson,
  migrations: [
    {
      dirName: CIPHERSTASH_BASELINE_MIGRATION_NAME,
      metadata: baselineMetadata,
      ops: baselineOps,
    },
  ],
  headRef,
});

const cipherstashExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  // Spread pack-meta first so it contributes `kind` / `id` / `familyId`
  // / `targetId` / `version` / `authoring` / `types.{codecTypes,storage}`
  // — then overlay the contract-space block and the codec lifecycle
  // hook on top. The two `types.codecTypes` slots (`codecInstances`
  // from pack-meta, `controlPlaneHooks` from this descriptor) coexist
  // on the same path and are merged below.
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
