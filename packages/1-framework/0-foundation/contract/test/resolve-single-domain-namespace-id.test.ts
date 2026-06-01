import { describe, expect, it } from 'vitest';
import { resolveSingleDomainNamespaceId } from '../src/domain-envelope';

describe('resolveSingleDomainNamespaceId — default namespace when multiple are declared', () => {
  it('selects public when both public and another namespace exist', () => {
    const domain = {
      namespaces: {
        auth: { models: {} },
        public: { models: {} },
      },
    };

    expect(resolveSingleDomainNamespaceId(domain)).toBe('public');
  });

  it('still returns the sole namespace for single-namespace contracts', () => {
    const domain = {
      namespaces: {
        __unbound__: { models: {} },
      },
    };

    expect(resolveSingleDomainNamespaceId(domain)).toBe('__unbound__');
  });
});
