import { describe, expect, it } from 'vitest';
import { DomainNamespaceResolutionError } from '../src/contract-validation-error';
import { soleDomainNamespaceId, UNBOUND_DOMAIN_NAMESPACE_ID } from '../src/default-namespace';

describe('UNBOUND_DOMAIN_NAMESPACE_ID', () => {
  it('is the late-bound domain sentinel', () => {
    expect(UNBOUND_DOMAIN_NAMESPACE_ID).toBe('__unbound__');
  });
});

describe('soleDomainNamespaceId', () => {
  it('throws when the domain declares no namespaces', () => {
    expect(() => soleDomainNamespaceId({ namespaces: {} })).toThrow(DomainNamespaceResolutionError);
  });

  it('returns the namespace when exactly one is declared', () => {
    expect(soleDomainNamespaceId({ namespaces: { auth: {} } })).toBe('auth');
  });

  it('throws when more than one namespace is declared rather than guessing', () => {
    expect(() => soleDomainNamespaceId({ namespaces: { auth: {}, public: {} } })).toThrow(
      DomainNamespaceResolutionError,
    );
  });
});
