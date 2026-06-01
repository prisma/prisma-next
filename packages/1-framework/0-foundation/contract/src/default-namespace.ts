import { DomainNamespaceResolutionError } from './contract-validation-error';

/**
 * Reserved sentinel domain namespace id for the late-bound application-domain
 * slot. Mirrors storage's `UNBOUND_NAMESPACE_ID` on the domain plane.
 */
export const UNBOUND_DOMAIN_NAMESPACE_ID = '__unbound__' as const;

/**
 * Default domain namespace for Postgres-family contracts at runtime.
 * Mirrors authoring's `POSTGRES_DEFAULT_NAMESPACE_ID` / `defaultModelNamespaceId`.
 */
export const POSTGRES_DEFAULT_DOMAIN_NAMESPACE_ID = 'public' as const;

/**
 * Per-target default domain namespace id for SQL-family contracts.
 */
export function defaultDomainNamespaceIdForSqlTarget(targetId: string): string {
  return targetId === 'postgres'
    ? POSTGRES_DEFAULT_DOMAIN_NAMESPACE_ID
    : UNBOUND_DOMAIN_NAMESPACE_ID;
}

/**
 * Default domain namespace id for Mongo-family contracts (single late-bound slot).
 */
export function defaultDomainNamespaceIdForMongo(): string {
  return UNBOUND_DOMAIN_NAMESPACE_ID;
}

/**
 * Infer the default domain namespace when callers omit an explicit namespace id.
 * Prefers `public`, then the unbound sentinel, then the sole namespace when only
 * one is declared.
 */
export function inferDefaultDomainNamespaceId(domain: {
  readonly namespaces: Readonly<Record<string, unknown>>;
}): string {
  const namespaceIds = Object.keys(domain.namespaces);
  if (namespaceIds.length === 0) {
    throw new DomainNamespaceResolutionError('domain has no namespaces');
  }
  if (namespaceIds.length === 1) {
    const [soleNamespaceId] = namespaceIds;
    if (soleNamespaceId === undefined) {
      throw new DomainNamespaceResolutionError('domain has no namespaces');
    }
    return soleNamespaceId;
  }
  if (Object.hasOwn(domain.namespaces, POSTGRES_DEFAULT_DOMAIN_NAMESPACE_ID)) {
    return POSTGRES_DEFAULT_DOMAIN_NAMESPACE_ID;
  }
  if (Object.hasOwn(domain.namespaces, UNBOUND_DOMAIN_NAMESPACE_ID)) {
    return UNBOUND_DOMAIN_NAMESPACE_ID;
  }
  throw new DomainNamespaceResolutionError(
    `cannot infer a default domain namespace among ${namespaceIds.length} namespaces (${namespaceIds.join(', ')})`,
  );
}
