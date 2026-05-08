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
 * R1 ships the `contractSpace` field only. The codec runtime
 * (`Encrypted<string>` encoding/decoding) and the
 * `controlPlaneHooks.onFieldEvent` lifecycle hook for
 * `add_search_config` / `remove_search_config` ops follow in M3 R2
 * (sub-spec § 4 + plan T3.4). `databaseDependencies` is intentionally
 * absent — CipherStash is greenfield on contract spaces and never used
 * the legacy `databaseDependencies.init` mechanism.
 */

import type {
  ExtensionContractSpace,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import { CIPHERSTASH_SPACE_ID } from '../core/constants';
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
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { cipherstashExtensionDescriptor };
export default cipherstashExtensionDescriptor;
