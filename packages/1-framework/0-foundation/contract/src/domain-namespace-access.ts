import { DomainNamespaceResolutionError } from './contract-validation-error';
import { inferDefaultDomainNamespaceId } from './default-namespace';
import type { ApplicationDomain } from './domain-envelope';
import type { ContractModelBase, ContractValueObject } from './domain-types';

/**
 * Models map for the contract's default domain namespace (runtime resolution).
 * When `defaultNamespaceId` is omitted, the default namespace is inferred.
 */
export function domainModelsAtDefaultNamespace<TModels extends Record<string, ContractModelBase>>(
  domain: ApplicationDomain<TModels>,
  defaultNamespaceId?: string,
): TModels {
  if (defaultNamespaceId !== undefined) {
    const preferredNamespace = domain.namespaces[defaultNamespaceId];
    if (preferredNamespace !== undefined) {
      return preferredNamespace.models;
    }
  }
  const namespaceId = inferDefaultDomainNamespaceId(domain);
  const domainNamespace = domain.namespaces[namespaceId];
  if (domainNamespace === undefined) {
    throw new DomainNamespaceResolutionError(
      `domain namespace "${namespaceId}" is not present on the contract`,
    );
  }
  return domainNamespace.models;
}

/**
 * Value objects for the contract's default domain namespace, when present.
 * When `defaultNamespaceId` is omitted, the default namespace is inferred.
 */
export function domainValueObjectsAtDefaultNamespace<
  TModels extends Record<string, ContractModelBase>,
>(
  domain: ApplicationDomain<TModels>,
  defaultNamespaceId?: string,
): Record<string, ContractValueObject> | undefined {
  if (defaultNamespaceId !== undefined) {
    const preferredNamespace = domain.namespaces[defaultNamespaceId];
    if (preferredNamespace !== undefined) {
      return preferredNamespace.valueObjects;
    }
  }
  const namespaceId = inferDefaultDomainNamespaceId(domain);
  return domain.namespaces[namespaceId]?.valueObjects;
}
