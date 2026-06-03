import {
  type Contract,
  type ContractModelBase,
  type ContractValueObject,
  UNBOUND_DOMAIN_NAMESPACE_ID,
} from '@prisma-next/contract/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { normalizeRootSqlStorage } from './sql-storage-fixture';

export function createEmitterTestContract(
  overrides: Partial<Contract> & {
    models?: Record<string, ContractModelBase>;
    valueObjects?: Record<string, ContractValueObject>;
  } = {},
): Contract {
  const { models, domain, storage, valueObjects, ...rest } = overrides;
  const merged = {
    targetFamily: 'sql' as const,
    target: 'test-db',
    roots: {},
    domain:
      domain ??
      applicationDomainOf({
        models: models ?? {},
        ...(valueObjects !== undefined ? { valueObjects } : {}),
        namespaceId: UNBOUND_DOMAIN_NAMESPACE_ID,
      }),
    extensionPacks: {},
    capabilities: {},
    meta: {},
    profileHash: 'sha256:test' as const,
    ...rest,
  };
  if (Object.hasOwn(overrides, 'storage')) {
    merged.storage =
      storage === undefined
        ? (storage as Contract['storage'])
        : (normalizeRootSqlStorage(storage) ?? storage);
  } else {
    merged.storage = normalizeRootSqlStorage({ tables: {} }) ?? { tables: {} };
  }
  const contract = merged as Contract;
  for (const [namespaceId, ns] of Object.entries(contract.domain.namespaces)) {
    for (const model of Object.values(ns.models ?? {})) {
      const storage = model.storage;
      if (
        storage !== null &&
        typeof storage === 'object' &&
        !Array.isArray(storage) &&
        !('namespaceId' in storage)
      ) {
        Object.assign(storage, { namespaceId });
      }
    }
  }
  return contract;
}
