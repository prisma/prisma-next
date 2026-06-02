import { DomainNamespaceResolutionError } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import { assertSingleDomainNamespaceForEmission } from '../src/assert-single-domain-namespace-for-emission';

describe('assertSingleDomainNamespaceForEmission', () => {
  it('returns the sole namespace id', () => {
    expect(
      assertSingleDomainNamespaceForEmission({
        namespaces: { public: { models: {} } },
      }),
    ).toBe('public');
  });

  it('throws when the domain has no namespaces', () => {
    expect(() =>
      assertSingleDomainNamespaceForEmission({
        namespaces: {},
      }),
    ).toThrow('domain has no namespaces');
  });

  it('throws when more than one domain namespace is declared', () => {
    expect(() =>
      assertSingleDomainNamespaceForEmission({
        namespaces: {
          auth: { models: {} },
          public: { models: {} },
        },
      }),
    ).toThrow(
      new DomainNamespaceResolutionError(
        'expected exactly one domain namespace for contract.d.ts emission, found 2 (auth, public)',
      ),
    );
  });
});
