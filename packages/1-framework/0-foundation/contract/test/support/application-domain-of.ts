import { blindCast } from '@prisma-next/utils/casts';
import type { ApplicationDomain } from '../../src/domain-envelope';
import { UNBOUND_DOMAIN_NAMESPACE_ID } from '../../src/domain-envelope';
import type { ContractModelBase, ContractValueObject } from '../../src/domain-types';

/**
 * Single-namespace application-domain authoring convenience for this package's
 * own tests. The shared copy lives in `@prisma-next/test-utils`, but the
 * foundation `contract` package cannot depend on test-utils (test-utils depends
 * on contract), so the helper is duplicated here to keep package boundaries
 * one-way.
 */
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
