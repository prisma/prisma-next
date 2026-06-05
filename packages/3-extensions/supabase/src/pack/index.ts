import type { SqlControlExtensionDescriptor } from '@prisma-next/family-sql/control';
import { blindCast } from '@prisma-next/utils/casts';
import type { Contract } from '../contract/contract.d';
import contractJson from '../contract/contract.json' with { type: 'json' };

const SUPABASE_SPACE_ID = 'supabase' as const;

/**
 * The head ref for the supabase extension contract space.
 *
 * No migrations — the external `auth.*`/`storage.*` tables are managed by
 * Supabase, not by our migration runner.  The hash is the storageHash
 * emitted by `prisma-next contract emit`; it is verified against the
 * contractJson at descriptor-load time by assertDescriptorSelfConsistency.
 */
const SUPABASE_HEAD_REF_INVARIANTS: readonly string[] = [];

const supabaseHeadRef = {
  hash: contractJson.storage.storageHash,
  invariants: SUPABASE_HEAD_REF_INVARIANTS,
};

function buildContractSpace(contractOverride?: unknown) {
  return {
    contractJson: blindCast<
      Contract,
      'JSON import narrowed to emitted Contract type; assertDescriptorSelfConsistency verifies the storageHash at load time'
    >(contractOverride ?? contractJson),
    migrations: [] as const,
    headRef: supabaseHeadRef,
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
