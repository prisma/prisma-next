import { DomainNamespaceResolutionError } from './contract-validation-error';
import { soleDomainNamespaceId } from './default-namespace';
import type { ApplicationDomain } from './domain-envelope';
import type { ContractModelBase, ContractValueObject } from './domain-types';

/**
 * Models map for the contract's single domain namespace. Throws when the
 * contract does not declare exactly one namespace — bare-name access is
 * ambiguous across namespaces and must be qualified explicitly (TML-2550).
 */
export function domainModelsAtDefaultNamespace(
  domain: ApplicationDomain,
): Record<string, ContractModelBase> {
  const namespaceId = soleDomainNamespaceId(domain);
  const domainNamespace = domain.namespaces[namespaceId];
  if (domainNamespace === undefined) {
    throw new DomainNamespaceResolutionError(
      `domain namespace "${namespaceId}" is not present on the contract`,
    );
  }
  return domainNamespace.models;
}

/**
 * Value objects for the contract's single domain namespace, when present.
 * Throws when the contract does not declare exactly one namespace.
 */
export function domainValueObjectsAtDefaultNamespace(
  domain: ApplicationDomain,
): Record<string, ContractValueObject> | undefined {
  return domain.namespaces[soleDomainNamespaceId(domain)]?.valueObjects;
}
