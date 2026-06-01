import type { ApplicationDomain } from '@prisma-next/contract/types';
import { DomainNamespaceResolutionError } from '@prisma-next/contract/types';

/**
 * Contract.d.ts emission supports a single domain namespace only (TML-2550).
 * Multi-namespace contracts must fail loudly rather than silently dropping namespaces.
 */
export function assertSingleDomainNamespaceForEmission(domain: ApplicationDomain): string {
  const namespaceIds = Object.keys(domain.namespaces);
  if (namespaceIds.length === 0) {
    throw new DomainNamespaceResolutionError('domain has no namespaces');
  }
  if (namespaceIds.length > 1) {
    throw new DomainNamespaceResolutionError(
      `expected exactly one domain namespace for contract.d.ts emission, found ${namespaceIds.length} (${namespaceIds.join(', ')})`,
    );
  }
  const soleNamespaceId = namespaceIds[0];
  if (soleNamespaceId === undefined) {
    throw new DomainNamespaceResolutionError('domain has no namespaces');
  }
  return soleNamespaceId;
}
