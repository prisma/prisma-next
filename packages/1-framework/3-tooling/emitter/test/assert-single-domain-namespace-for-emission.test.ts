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

  it('throws when more than one domain namespace is declared', () => {
    expect(() =>
      assertSingleDomainNamespaceForEmission({
        namespaces: {
          auth: { models: {} },
          public: { models: {} },
        },
      }),
    ).toThrow(DomainNamespaceResolutionError);
  });
});
