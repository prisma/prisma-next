import { DomainNamespaceResolutionError } from './contract-validation-error';
import { inferDefaultDomainNamespaceId } from './default-namespace';
import type { ContractModelBase, ContractValueObject } from './domain-types';

export { UNBOUND_DOMAIN_NAMESPACE_ID } from './default-namespace';

/**
 * One namespace's application-domain entities — models and optional value
 * objects keyed by entity name within that namespace coordinate.
 */
export interface ApplicationDomainNamespace<
  TModels extends Record<string, ContractModelBase> = Record<string, ContractModelBase>,
> {
  readonly models: TModels;
  readonly valueObjects?: Record<string, ContractValueObject>;
}

/**
 * Application-domain envelope: entity content keyed by namespace id.
 * Mirrors the storage plane's `namespaces` segment (ADR 221).
 */
export interface ApplicationDomain<
  TModels extends Record<string, ContractModelBase> = Record<string, ContractModelBase>,
> {
  readonly namespaces: Readonly<Record<string, ApplicationDomainNamespace<TModels>>>;
}

export type ContractWithDomain = {
  readonly domain: ApplicationDomain;
};

export function resolveSingleDomainNamespaceId(
  domain: ApplicationDomain,
  namespaceId?: string,
): string {
  if (namespaceId !== undefined) {
    if (!Object.hasOwn(domain.namespaces, namespaceId)) {
      throw new DomainNamespaceResolutionError(
        `domain namespace "${namespaceId}" is not present on the contract`,
      );
    }
    return namespaceId;
  }

  return inferDefaultDomainNamespaceId(domain);
}

// Transitional single-namespace projection; pending runtime-qualification slice.
export function contractModels<TModels extends Record<string, ContractModelBase>>(
  contract: { readonly domain: ApplicationDomain<TModels> },
  namespaceId?: string,
): TModels {
  const resolved = resolveSingleDomainNamespaceId(contract.domain, namespaceId);
  const domainNamespace = contract.domain.namespaces[resolved];
  if (domainNamespace === undefined) {
    throw new DomainNamespaceResolutionError(
      `domain namespace "${resolved}" is not present on the contract`,
    );
  }
  return domainNamespace.models;
}

export function contractValueObjects<TModels extends Record<string, ContractModelBase>>(
  contract: { readonly domain: ApplicationDomain<TModels> },
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
