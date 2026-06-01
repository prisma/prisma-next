import { describe, expect, it } from 'vitest';
import {
  defaultDomainNamespaceIdForMongo,
  defaultDomainNamespaceIdForSqlTarget,
  POSTGRES_DEFAULT_DOMAIN_NAMESPACE_ID,
  UNBOUND_DOMAIN_NAMESPACE_ID,
} from '../src/default-namespace';

describe('defaultDomainNamespaceIdForSqlTarget', () => {
  it('uses public for postgres', () => {
    expect(defaultDomainNamespaceIdForSqlTarget('postgres')).toBe(
      POSTGRES_DEFAULT_DOMAIN_NAMESPACE_ID,
    );
    expect(POSTGRES_DEFAULT_DOMAIN_NAMESPACE_ID).toBe('public');
  });

  it('uses the unbound sentinel for non-postgres SQL targets', () => {
    expect(defaultDomainNamespaceIdForSqlTarget('sqlite')).toBe(UNBOUND_DOMAIN_NAMESPACE_ID);
  });
});

describe('defaultDomainNamespaceIdForMongo', () => {
  it('uses the unbound sentinel', () => {
    expect(defaultDomainNamespaceIdForMongo()).toBe(UNBOUND_DOMAIN_NAMESPACE_ID);
  });
});
