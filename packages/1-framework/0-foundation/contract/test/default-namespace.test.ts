import { describe, expect, it } from 'vitest';
import { DomainNamespaceResolutionError } from '../src/contract-validation-error';
import {
  inferDefaultDomainNamespaceId,
  UNBOUND_DOMAIN_NAMESPACE_ID,
} from '../src/default-namespace';

describe('UNBOUND_DOMAIN_NAMESPACE_ID', () => {
  it('is the late-bound domain sentinel', () => {
    expect(UNBOUND_DOMAIN_NAMESPACE_ID).toBe('__unbound__');
  });
});

describe('inferDefaultDomainNamespaceId', () => {
  it('throws when the domain declares no namespaces', () => {
    expect(() => inferDefaultDomainNamespaceId({ namespaces: {} })).toThrow(
      DomainNamespaceResolutionError,
    );
  });

  it('returns the sole namespace when only one is declared', () => {
    expect(inferDefaultDomainNamespaceId({ namespaces: { auth: {} } })).toBe('auth');
  });

  it('returns the first namespace by insertion order when several are declared', () => {
    expect(inferDefaultDomainNamespaceId({ namespaces: { auth: {}, public: {} } })).toBe('auth');
    expect(inferDefaultDomainNamespaceId({ namespaces: { public: {}, auth: {} } })).toBe('public');
  });
});
