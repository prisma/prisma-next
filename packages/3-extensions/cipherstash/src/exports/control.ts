/**
 * Control-plane descriptor for the CipherStash extension.
 *
 * Exposes a `contractSpace` so the framework's per-space planner /
 * runner / verifier (project: extension-contract-spaces, M1 + M2)
 * manages CipherStash's database scaffolding the same way it manages
 * an application's own schema. The descriptor is consumed by the
 * framework only at authoring time (`migrate`); apply / verify paths
 * read the user's repo (`migrations/cipherstash/...`) instead — see
 * project spec NFR3 / FR2 / FR10.
 *
 * Wired surfaces:
 *
 *   - `contractSpace.{contractJson,migrations,headRef}` — see
 *     `../core/contract.ts` and `../core/migrations.ts`.
 *   - `types.codecTypes.controlPlaneHooks[CIPHERSTASH_STRING_CODEC_ID]`
 *     — the lifecycle hook the SQL planner extracts via
 *     `extractCodecControlHooks` and inlines into the application's
 *     migration via `planFieldEventOperations` (sub-spec § 5). Implements
 *     `add_search_config` / `remove_search_config` / rotate behaviour
 *     for `searchable: true` `Encrypted<string>` columns (sub-spec § 4).
 */

import type {
  ExtensionContractSpace,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import { cipherstashStringCodecHooks } from '../core/cipherstash-codec';
import { CIPHERSTASH_SPACE_ID, CIPHERSTASH_STRING_CODEC_ID } from '../core/constants';
import { cipherstashContract } from '../core/contract';
import { cipherstashBaselineMigration, cipherstashHeadRef } from '../core/migrations';

const cipherstashContractSpace: ExtensionContractSpace = {
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
   * family's `extractCodecControlHooks` (in `@prisma-next/family-sql/
   * control`) finds hooks via duck-typing on this exact path. Mirrors
   * pgvector's wiring at `packages/3-extensions/pgvector/src/exports/
   * control.ts` (which carries a fuller `pack-meta`).
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
