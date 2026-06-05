import { DomainNamespaceResolutionError } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import { generateContractDts } from '../src/generate-contract-dts';
import { createMockSpi } from './mock-spi';
import { createTestContract } from './utils';

const mockSqlHook = createMockSpi();

const HASHES = {
  storageHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
  profileHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000002',
};

describe('generateContractDts domain namespace handling', () => {
  it('emits successfully for a single namespace', () => {
    const contract = {
      ...createTestContract(),
      domain: {
        namespaces: {
          public: { models: {} },
        },
      },
    };
    const dts = generateContractDts(contract, mockSqlHook, [], HASHES);
    expect(dts).toContain('readonly public:');
  });

  it('emits successfully for multiple namespaces (flatten, first-name-wins)', () => {
    const contract = {
      ...createTestContract(),
      domain: {
        namespaces: {
          auth: { models: {} },
          storage: { models: {} },
        },
      },
    };
    const dts = generateContractDts(contract, mockSqlHook, [], HASHES);
    expect(dts).toContain('readonly auth:');
    expect(dts).toContain('readonly storage:');
  });

  it('throws when the domain has no namespaces', () => {
    const contract = {
      ...createTestContract(),
      domain: { namespaces: {} },
    };
    expect(() => generateContractDts(contract, mockSqlHook, [], HASHES)).toThrow(
      new DomainNamespaceResolutionError('domain has no namespaces'),
    );
  });
});
