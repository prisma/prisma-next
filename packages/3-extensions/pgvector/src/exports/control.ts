/**
 * Control-plane descriptor for the pgvector extension.
 *
 * Exposes a `contractSpace` so the framework's per-space planner /
 * runner / verifier (project: extension-contract-spaces, M1+M2)
 * manages the pgvector extension's database scaffolding the same way
 * it manages an application's own schema. The descriptor is consumed
 * by the framework only at authoring time (`migrate`); apply / verify
 * paths read the user's repo (`migrations/pgvector/...`) instead — see
 * project spec NFR3 / FR2 / FR10.
 *
 * `databaseDependencies` is intentionally absent — pgvector was
 * migrated off the legacy `databaseDependencies.init` mechanism in M4
 * (project spec FR13). The `CREATE EXTENSION IF NOT EXISTS vector`
 * DDL the legacy entry carried now lives as the body of the
 * `installVectorExtension` op inside the baseline migration package
 * (`../core/migrations.ts`). Presence of `contractSpace` is the
 * shipping-strategy gate: the framework loads the contract space and
 * ignores any `databaseDependencies` block (project plan §
 * "Shipping Strategy"). M5 removes the field at the framework level.
 */

import type {
  CodecControlHooks,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import type { ContractSpace } from '@prisma-next/framework-components/control';
import { pgvectorContract } from '../core/contract';
import { PGVECTOR_SPACE_ID } from '../core/contract-space-constants';
import { pgvectorPackMeta, pgvectorQueryOperations } from '../core/descriptor-meta';
import { pgvectorBaselineMigration, pgvectorHeadRef } from '../core/migrations';

const PGVECTOR_CODEC_ID = 'pg/vector@1' as const;

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

const pgvectorContractSpace: ContractSpace = {
  contractJson: pgvectorContract,
  migrations: [pgvectorBaselineMigration],
  headRef: pgvectorHeadRef,
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
