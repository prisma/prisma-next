import type { SqlControlExtensionDescriptor } from '@prisma-next/family-sql/control';
import { blindCast } from '@prisma-next/utils/casts';
import baselineMigrationJson from '../../migrations/20260605T0000_establish_external_supabase_tables/migration.json' with {
  type: 'json',
};
import baselineOpsJson from '../../migrations/20260605T0000_establish_external_supabase_tables/ops.json' with {
  type: 'json',
};
import headRefJson from '../../migrations/refs/head.json' with { type: 'json' };
import type { Contract } from '../contract/contract.d';
import contractJson from '../contract/contract.json' with { type: 'json' };

const SUPABASE_SPACE_ID = 'supabase' as const;
const SUPABASE_DIR_NAME = '20260605T0000_establish_external_supabase_tables' as const;

/**
 * The baseline migration for the supabase extension contract space.
 *
 * The supabase extension ships one zero-ops baseline migration: its graph
 * transitions from `EMPTY_CONTRACT_HASH` (null) to the supabase storage hash,
 * establishing the head ref without emitting any DDL. The `auth.*` and
 * `storage.*` tables are managed by Supabase; this migration records that the
 * supabase contract space has been "installed" (i.e. those tables are expected
 * to exist) but takes no action to create them.
 */
const supabaseBaselineMigration = {
  dirName: SUPABASE_DIR_NAME,
  metadata: baselineMigrationJson,
  ops: baselineOpsJson,
} as const;

function buildContractSpace(contractOverride?: unknown) {
  return {
    contractJson: blindCast<
      Contract,
      'JSON import narrowed to emitted Contract type; assertDescriptorSelfConsistency verifies the storageHash at load time'
    >(contractOverride ?? contractJson),
    migrations: [supabaseBaselineMigration] as const,
    headRef: headRefJson,
  };
}

const supabaseContractSpace = buildContractSpace();

const supabasePackBase = {
  kind: 'extension' as const,
  id: SUPABASE_SPACE_ID,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  version: '0.12.0',
  contractSpace: supabaseContractSpace,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
} satisfies SqlControlExtensionDescriptor<'postgres'>;

export const supabasePack: SqlControlExtensionDescriptor<'postgres'> = supabasePackBase;

/**
 * Returns a pack using `contractOverride` in place of the shipped
 * `contract.json` when provided, otherwise returns the default pack.
 *
 * Intended for tests that need to drive the framework with a synthetic
 * contract while still exercising the full descriptor wiring.
 */
export function supabasePackWith(options?: {
  contractOverride?: unknown;
}): SqlControlExtensionDescriptor<'postgres'> {
  if (options?.contractOverride === undefined) return supabasePack;
  return {
    ...supabasePackBase,
    contractSpace: buildContractSpace(options.contractOverride),
  };
}

export default supabasePack;
