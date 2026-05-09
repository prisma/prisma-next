/**
 * Control-plane descriptor for the pgvector extension.
 *
 * **On-disk-in-package authoring (M3.5 R3).** The extension's contract
 * + migrations are emitted by the same pipeline application authors use:
 *
 *   `prisma-next contract emit` → `<package>/contract.{json,d.ts}`
 *   `prisma-next migration plan` → `<package>/migrations/pgvector/<dir>/...`
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
 *   - `types.codecTypes.controlPlaneHooks[PGVECTOR_CODEC_ID]` — codec
 *     control hooks (`expandNativeType`, `resolveIdentityValue`) the
 *     SQL planner extracts via `extractCodecControlHooks` and uses to
 *     render `vector(N)` column types and the canonical zero-vector
 *     identity literal.
 *
 * @see docs/architecture docs/adrs/ADR 211 - Contract spaces.md
 *   (on-disk-in-package authoring convention).
 * @see packages/3-extensions/test-contract-space/src/exports/control.ts
 *   (R1 reference model).
 */

import { fileURLToPath } from 'node:url';
import type { Contract } from '@prisma-next/contract/types';
import type {
  CodecControlHooks,
  ExtensionContractSpace,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import type { MigrationPackage } from '@prisma-next/migration-tools/package';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import contractJson from '../../contract.json' with { type: 'json' };
import baselineMetadata from '../../migrations/pgvector/20260601T0000_install_vector_extension/migration.json' with {
  type: 'json',
};
import baselineOps from '../../migrations/pgvector/20260601T0000_install_vector_extension/ops.json' with {
  type: 'json',
};
import headRef from '../../refs/head.json' with { type: 'json' };
import { PGVECTOR_SPACE_ID } from '../core/contract-space-constants';
import { pgvectorPackMeta, pgvectorQueryOperations } from '../core/descriptor-meta';

const PGVECTOR_CODEC_ID = 'pg/vector@1' as const;
const BASELINE_DIR_NAME = '20260601T0000_install_vector_extension';

function buildVectorIdentityValue(typeParams: Record<string, unknown> | undefined): string | null {
  const length = typeParams?.['length'];
  if (typeof length !== 'number' || !Number.isInteger(length) || length <= 0) {
    return null;
  }

  const zeroVector = `[${new Array(length).fill('0').join(',')}]`;
  return `'${zeroVector}'::vector`;
}

const vectorControlPlaneHooks: CodecControlHooks = {
  expandNativeType: ({ nativeType, typeParams }) => {
    const length = typeParams?.['length'];
    if (typeof length === 'number' && Number.isInteger(length) && length > 0) {
      return `${nativeType}(${length})`;
    }
    return nativeType;
  },
  resolveIdentityValue: ({ typeParams }) => buildVectorIdentityValue(typeParams),
};

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
    new URL(`../../migrations/${PGVECTOR_SPACE_ID}/${dirName}/`, import.meta.url),
  );
}

// JSON-imported values lose the workspace's branded types
// (e.g. `StorageHashBase<string>`, `MigrationPlanOperation` discriminants),
// so we cast through `unknown` here. The values themselves are the same
// canonical artefacts the application's contract / migration runners
// produce and re-validate at runtime — the descriptor is just a
// pass-through wiring layer between the on-disk JSON and the framework's
// typed surface.
const baselinePackage: MigrationPackage = {
  dirName: BASELINE_DIR_NAME,
  dirPath: resolveMigrationDirPath(BASELINE_DIR_NAME),
  metadata: baselineMetadata as unknown as MigrationMetadata,
  ops: baselineOps as unknown as readonly MigrationPlanOperation[],
};

const pgvectorContractSpace: ExtensionContractSpace = {
  contractJson: contractJson as unknown as Contract<SqlStorage>,
  migrations: [baselinePackage],
  headRef,
};

const pgvectorExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  ...pgvectorPackMeta,
  id: PGVECTOR_SPACE_ID,
  contractSpace: pgvectorContractSpace,
  types: {
    ...pgvectorPackMeta.types,
    codecTypes: {
      ...pgvectorPackMeta.types.codecTypes,
      controlPlaneHooks: {
        [PGVECTOR_CODEC_ID]: vectorControlPlaneHooks,
      },
    },
  },
  queryOperations: () => pgvectorQueryOperations(),
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { pgvectorExtensionDescriptor };
export default pgvectorExtensionDescriptor;
