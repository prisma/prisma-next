import { blindCast } from '@prisma-next/utils/casts';
import type { ContractModelBase, ContractValueObject } from './domain-types';
import type { NamespaceId } from './namespace-id';

export const UNBOUND_DOMAIN_NAMESPACE_ID = '__unbound__' as const;

/**
 * One namespace's domain entities on the framework domain plane — models and
 * optional value objects keyed by entity name within that namespace coordinate.
 */
export interface DomainNamespace<
  TModels extends Record<string, ContractModelBase> = Record<string, ContractModelBase>,
> {
  readonly models: TModels;
  readonly valueObjects?: Record<string, ContractValueObject>;
}

/**
 * Framework domain plane envelope: entity content keyed by namespace id.
 * Mirrors the storage plane's `namespaces` segment (ADR 221).
 */
export interface DomainPlane<
  TModels extends Record<string, ContractModelBase> = Record<string, ContractModelBase>,
> {
  readonly namespaces: Readonly<Record<string, DomainNamespace<TModels>>>;
}

export type ContractWithDomain = {
  readonly domain: DomainPlane;
};

export class DomainNamespaceResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainNamespaceResolutionError';
  }
}

export function resolveSingleDomainNamespaceId(domain: DomainPlane, namespaceId?: string): string {
  if (namespaceId !== undefined) {
    if (!Object.hasOwn(domain.namespaces, namespaceId)) {
      throw new DomainNamespaceResolutionError(
        `domain namespace "${namespaceId}" is not present on the contract`,
      );
    }
    return namespaceId;
  }

  const namespaceIds = Object.keys(domain.namespaces);
  if (namespaceIds.length === 0) {
    throw new DomainNamespaceResolutionError('domain has no namespaces');
  }
  if (namespaceIds.length > 1) {
    throw new DomainNamespaceResolutionError(
      `expected exactly one domain namespace, found ${namespaceIds.length} (${namespaceIds.join(', ')})`,
    );
  }
  const [soleNamespaceId] = namespaceIds;
  if (soleNamespaceId === undefined) {
    throw new DomainNamespaceResolutionError('domain has no namespaces');
  }
  return soleNamespaceId;
}

export function contractModels(
  contract: ContractWithDomain,
  namespaceId?: string,
): Record<string, ContractModelBase> {
  const resolved = resolveSingleDomainNamespaceId(contract.domain, namespaceId);
  const domainNamespace = contract.domain.namespaces[resolved];
  if (domainNamespace === undefined) {
    throw new DomainNamespaceResolutionError(
      `domain namespace "${resolved}" is not present on the contract`,
    );
  }
  return domainNamespace.models;
}

export function contractValueObjects(
  contract: ContractWithDomain,
  namespaceId?: string,
): Record<string, ContractValueObject> | undefined {
  const resolved = resolveSingleDomainNamespaceId(contract.domain, namespaceId);
  const domainNamespace = contract.domain.namespaces[resolved];
  if (domainNamespace === undefined) {
    throw new DomainNamespaceResolutionError(
      `domain namespace "${resolved}" is not present on the contract`,
    );
  }
  return domainNamespace.valueObjects;
}

export function domainPlaneOf<TModels extends Record<string, ContractModelBase>>(params: {
  readonly models?: TModels;
  readonly valueObjects?: Record<string, ContractValueObject>;
  readonly namespaceId?: string;
}): DomainPlane<TModels> {
  const namespaceId = params.namespaceId ?? UNBOUND_DOMAIN_NAMESPACE_ID;
  const models =
    params.models ?? blindCast<TModels, 'default empty models when domainPlaneOf omits models'>({});
  return {
    namespaces: {
      [namespaceId]: {
        models,
        ...(params.valueObjects !== undefined ? { valueObjects: params.valueObjects } : {}),
      },
    },
  };
}

export function modelCoordinateKey(namespace: NamespaceId, model: string): string {
  return `${namespace}:${model}`;
}
