import type { Contract } from '@prisma-next/contract/types';
import type { EmissionSpi } from '@prisma-next/framework-components/emission';
import { describe, expect, it } from 'vitest';
import { generateContractDts } from '../src/generate-contract-dts';
import { createMockSpi } from './mock-spi';
import { createTestContract } from './utils';

const HASHES = {
  storageHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
  profileHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000002',
};

function makeEnumContract(opts: {
  valueSet: {
    readonly plane: 'domain' | 'storage';
    readonly namespaceId: string;
    readonly entityKind: 'enum' | 'valueSet';
    readonly entityName: string;
  };
  includeEnumBlock: boolean;
}): Contract {
  const base = createTestContract();
  const post = {
    fields: {
      priority: {
        nullable: false,
        type: { kind: 'scalar' as const, codecId: 'pg/text@1' },
        valueSet: opts.valueSet,
      },
    },
    relations: {},
    storage: {},
  };
  const publicNs: Record<string, unknown> = { models: { Post: post } };
  if (opts.includeEnumBlock) {
    publicNs['enum'] = {
      Priority: {
        codecId: 'pg/text@1',
        members: [
          { name: 'Low', value: 'low' },
          { name: 'High', value: 'high' },
        ],
      },
    };
  }
  return {
    ...base,
    domain: { namespaces: { public: publicNs } },
  } as unknown as Contract;
}

describe('generateContractDts SPI hook plumbing', () => {
  it('omits extra storage exports when the SPI has no getStorageTypeExports hook', () => {
    const spi: EmissionSpi = createMockSpi();
    const dts = generateContractDts(createTestContract(), spi, [], HASHES);
    expect(dts).not.toContain('export type StorageColumnTypes');
    expect(dts).not.toContain('export type StorageColumnInputTypes');
  });

  it('inserts the SPI-provided storage exports when getStorageTypeExports returns a string', () => {
    const spi: EmissionSpi = createMockSpi({
      getStorageTypeExports: () =>
        ['export type StorageColumnTypes = {};', 'export type StorageColumnInputTypes = {};'].join(
          '\n',
        ),
    });
    const dts = generateContractDts(createTestContract(), spi, [], HASHES);
    expect(dts).toContain('export type StorageColumnTypes = {};');
    expect(dts).toContain('export type StorageColumnInputTypes = {};');
  });

  it('omits extra exports when getStorageTypeExports returns undefined', () => {
    const spi: EmissionSpi = createMockSpi({ getStorageTypeExports: () => undefined });
    const dts = generateContractDts(createTestContract(), spi, [], HASHES);
    expect(dts).not.toContain('export type StorageColumnTypes');
  });
});

describe('generateContractDts domainEnumLookup wiring', () => {
  it('narrows a domain-enum-valueSet field to the literal union from the enum block', () => {
    const contract = makeEnumContract({
      valueSet: {
        plane: 'domain',
        namespaceId: 'public',
        entityKind: 'enum',
        entityName: 'Priority',
      },
      includeEnumBlock: true,
    });
    const dts = generateContractDts(contract, createMockSpi(), [], HASHES);
    expect(dts).toContain("readonly priority: 'low' | 'high'");
  });

  it('does not narrow a storage-plane valueSet (entityKind: "valueSet")', () => {
    const contract = makeEnumContract({
      valueSet: {
        plane: 'storage',
        namespaceId: 'public',
        entityKind: 'valueSet',
        entityName: 'Priority',
      },
      includeEnumBlock: true,
    });
    const dts = generateContractDts(contract, createMockSpi(), [], HASHES);
    expect(dts).toContain("readonly priority: CodecTypes['pg/text@1']['output']");
  });

  it('returns undefined when the referenced namespace is missing from the domain', () => {
    const contract = makeEnumContract({
      valueSet: {
        plane: 'domain',
        namespaceId: 'no-such-ns',
        entityKind: 'enum',
        entityName: 'Priority',
      },
      includeEnumBlock: true,
    });
    const dts = generateContractDts(contract, createMockSpi(), [], HASHES);
    expect(dts).toContain("readonly priority: CodecTypes['pg/text@1']['output']");
  });

  it('returns undefined when the referenced enum is absent from the namespace block', () => {
    const contract = makeEnumContract({
      valueSet: {
        plane: 'domain',
        namespaceId: 'public',
        entityKind: 'enum',
        entityName: 'Priority',
      },
      includeEnumBlock: false,
    });
    const dts = generateContractDts(contract, createMockSpi(), [], HASHES);
    expect(dts).toContain("readonly priority: CodecTypes['pg/text@1']['output']");
  });
});
