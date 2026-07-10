/**
 * Control-plane pack descriptor for the better-auth extension.
 *
 * The package's contract + migrations are emitted by the same pipeline
 * application authors use:
 *
 *   `prisma-next contract emit` → `<package>/src/contract/contract.{json,d.ts}`
 *   `prisma-next migration plan` → `<package>/migrations/<dirName>/...`
 *
 * The descriptor wires those JSON artefacts via JSON-import declarations
 * so they flow through the consuming application's module resolver
 * without filesystem assumptions.
 *
 * The contract space is **managed** (the contract default): `db init` /
 * `db update` walk the space's migration graph to create and verify the
 * four BetterAuth core tables — the framework owns the DDL lifecycle,
 * not the consuming app and not an external system.
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 *   (contract-space package layout convention).
 */

import type { SqlControlExtensionDescriptor } from '@prisma-next/family-sql/control';
import { contractSpaceFromJson } from '@prisma-next/migration-tools/spaces';
import baselineMetadata from '../../migrations/20260710T1458_create_auth_tables/migration.json' with {
  type: 'json',
};
import baselineOps from '../../migrations/20260710T1458_create_auth_tables/ops.json' with {
  type: 'json',
};
import headRef from '../../migrations/refs/head.json' with { type: 'json' };
import packageJson from '../../package.json' with { type: 'json' };
import type { Contract } from '../contract/contract.d';
import contractJson from '../contract/contract.json' with { type: 'json' };

const BETTER_AUTH_SPACE_ID = 'better-auth' as const;
const BASELINE_DIR_NAME = '20260710T1458_create_auth_tables';

const betterAuthContractSpace = contractSpaceFromJson<Contract>({
  contractJson,
  migrations: [
    {
      dirName: BASELINE_DIR_NAME,
      metadata: baselineMetadata,
      ops: baselineOps,
    },
  ],
  headRef,
});

export const betterAuthPack: SqlControlExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: BETTER_AUTH_SPACE_ID,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  version: packageJson.version,
  contractSpace: betterAuthContractSpace,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export default betterAuthPack;
