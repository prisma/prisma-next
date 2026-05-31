import {
  type Contract,
  type ContractModelBase,
  type ContractValueObject,
  UNBOUND_DOMAIN_NAMESPACE_ID,
} from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { applicationDomainOf } from '@prisma-next/test-utils';

export function namespacedMongoStorageFromCollections(
  collections: Record<string, unknown>,
  storageHash = 'sha256:test',
) {
  return {
    storageHash,
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, collections },
    },
  } as Contract['storage'];
}

export function createMongoContract(
  overrides: Partial<Contract> & {
    models?: Record<string, ContractModelBase>;
    valueObjects?: Record<string, ContractValueObject>;
  } = {},
): Contract {
  const { models, domain, valueObjects, ...rest } = overrides;
  return {
    targetFamily: 'mongo' as const,
    target: 'mongo',
    domain:
      domain ??
      applicationDomainOf({
        models: models ?? {},
        ...(valueObjects !== undefined ? { valueObjects } : {}),
        namespaceId: UNBOUND_DOMAIN_NAMESPACE_ID,
      }),
    storage: namespacedMongoStorageFromCollections({}) as Contract['storage'],
    extensionPacks: {},
    capabilities: {},
    meta: {},
    roots: {},
    profileHash: 'sha256:test' as const,
    ...rest,
  } as Contract;
}
