import type { ApplicationDomain } from '@prisma-next/contract/types';
import { DomainNamespaceResolutionError } from '@prisma-next/contract/types';

/**
 * Contract.d.ts emission supports a single domain namespace only (TML-2550).
 * Multi-namespace contracts must fail loudly rather than silently dropping namespaces.
 */
export function assertSingleDomainNamespaceForEmission(domain: ApplicationDomain): string {
  const [soleNamespaceId, ...rest] = Object.keys(domain.namespaces);
  if (soleNamespaceId === undefined) {
    throw new DomainNamespaceResolutionError('domain has no namespaces');
  }
  if (rest.length > 0) {
    const all = [soleNamespaceId, ...rest];
    throw new DomainNamespaceResolutionError(
      `expected exactly one domain namespace for contract.d.ts emission, found ${all.length} (${all.join(', ')})`,
    );
  }
  return soleNamespaceId;
}
