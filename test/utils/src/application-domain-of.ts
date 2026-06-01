import {
  type ApplicationDomain,
  type ContractModelBase,
  type ContractValueObject,
  UNBOUND_DOMAIN_NAMESPACE_ID,
} from '@prisma-next/contract/types';
import { blindCast } from '@prisma-next/utils/casts';

export function applicationDomainOf<TModels extends Record<string, ContractModelBase>>(params: {
  readonly models?: TModels;
  readonly valueObjects?: Record<string, ContractValueObject>;
  readonly namespaceId?: string;
}): ApplicationDomain<TModels> {
  const namespaceId = params.namespaceId ?? UNBOUND_DOMAIN_NAMESPACE_ID;
  const models =
    params.models ??
    blindCast<TModels, 'default empty models when applicationDomainOf omits models'>({});
  return {
    namespaces: {
      [namespaceId]: {
        models,
        ...(params.valueObjects !== undefined ? { valueObjects: params.valueObjects } : {}),
      },
    },
  };
}
