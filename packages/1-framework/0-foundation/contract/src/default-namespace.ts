import { DomainNamespaceResolutionError } from './contract-validation-error';

/**
 * Reserved sentinel domain namespace id for the late-bound application-domain
 * slot. Mirrors storage's `UNBOUND_NAMESPACE_ID` on the domain plane.
 */
export const UNBOUND_DOMAIN_NAMESPACE_ID = '__unbound__' as const;

/**
 * Infer the default domain namespace when callers omit an explicit namespace id.
 * Returns the sole namespace when only one is declared, otherwise the first
 * namespace in insertion order. Throws when the domain declares none.
 */
export function inferDefaultDomainNamespaceId(domain: {
  readonly namespaces: Readonly<Record<string, unknown>>;
}): string {
  const namespaceIds = Object.keys(domain.namespaces);
  const [firstNamespaceId] = namespaceIds;
  if (firstNamespaceId === undefined) {
    throw new DomainNamespaceResolutionError('domain has no namespaces');
  }
  return firstNamespaceId;
}
