import {
  type ContractModelBase,
  crossRef,
  UNBOUND_DOMAIN_NAMESPACE_ID,
} from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { applicationDomainOf } from '@prisma-next/test-utils';

export function mongoContractJson(params: {
  readonly models?: Record<string, ContractModelBase>;
  readonly storageCollections?: Record<string, unknown>;
  readonly roots?: Record<string, ReturnType<typeof crossRef>>;
}) {
  const models = params.models ?? {
    Item: {
      fields: { _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false } },
      storage: { collection: 'items' },
    },
  };
  const collections = params.storageCollections ?? { items: {} };
  return {
    targetFamily: 'mongo',
    target: 'mongo',
    profileHash: 'sha256:test',
    roots: params.roots ?? { items: crossRef('Item') },
    domain: applicationDomainOf({ models, namespaceId: UNBOUND_DOMAIN_NAMESPACE_ID }),
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, collections },
      },
    },
  };
}
