/**
 * Control-plane descriptor for the CipherStash extension.
 *
 * Exposes a `contractSpace` so the framework's per-space planner /
 * runner / verifier manages CipherStash's database scaffolding the same
 * way it manages an application's own schema. The descriptor is consumed
 * by the framework only at authoring time (`migrate`); apply / verify
 * paths read the user's repo (`migrations/cipherstash/...`) instead.
 *
 * Wired surfaces:
 *
 *   - `contractSpace.{contractJson,migrations,headRef}` — see
 *     `../core/contract.ts` and `../core/migrations.ts`.
 *   - `types.codecTypes.controlPlaneHooks[CIPHERSTASH_STRING_CODEC_ID]`
 *     — the lifecycle hook the SQL planner uses to emit
 *     `add_search_config` / `remove_search_config` / rotate ops for
 *     `searchable: true` `Encrypted<string>` columns.
 *
 * `databaseDependencies` is intentionally absent — CipherStash is
 * contract-space-only and does not use the legacy
 * `databaseDependencies.init` mechanism.
 */

import type { Contract } from '@prisma-next/contract/types';
import type { SqlControlExtensionDescriptor } from '@prisma-next/family-sql/control';
import type { ContractSpace } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { cipherstashStringCodecHooks } from '../core/cipherstash-codec';
import { CIPHERSTASH_SPACE_ID, CIPHERSTASH_STRING_CODEC_ID } from '../core/constants';
import { cipherstashContract } from '../core/contract';
import { cipherstashBaselineMigration, cipherstashHeadRef } from '../core/migrations';

const cipherstashContractSpace: ContractSpace<Contract<SqlStorage>> = {
  contractJson: cipherstashContract,
  migrations: [cipherstashBaselineMigration],
  headRef: cipherstashHeadRef,
};

const cipherstashExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: CIPHERSTASH_SPACE_ID,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  version: '0.0.1',
  contractSpace: cipherstashContractSpace,
  /**
   * Free-form `types.codecTypes.controlPlaneHooks` block — the SQL
   * family's `extractCodecControlHooks` finds hooks via duck-typing on
   * this exact path.
   */
  types: {
    codecTypes: {
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
