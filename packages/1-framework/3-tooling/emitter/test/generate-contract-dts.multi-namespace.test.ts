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

  it('first-name-wins when two namespaces declare the same bare model name', () => {
    // Both namespaces have a 'User' model. 'auth' comes first in iteration order.
    // The flattened top-level ContractType<…, models> uses auth's User (field 'emailAddress')
    // and drops public's User (field 'roleLabel') from the flatten.
    const authUserModel = {
      fields: {
        emailAddress: { type: { kind: 'scalar' as const, codecId: 'pg/text@1' }, nullable: false },
      },
      relations: {},
      storage: {
        namespaceId: 'auth',
        table: 'users',
        fields: { emailAddress: { column: 'email_address' } },
      },
    };
    const publicUserModel = {
      fields: {
        roleLabel: { type: { kind: 'scalar' as const, codecId: 'pg/text@1' }, nullable: true },
      },
      relations: {},
      storage: {
        namespaceId: 'public',
        table: 'users',
        fields: { roleLabel: { column: 'role_label' } },
      },
    };
    const contract = {
      ...createTestContract(),
      domain: {
        namespaces: {
          auth: { models: { User: authUserModel } },
          public: { models: { User: publicUserModel } },
        },
      },
    };
    const dts = generateContractDts(contract, mockSqlHook, [], HASHES);
    // The flattened top-level models type is still first-name-wins (auth's User), but the
    // FieldOutputTypes / FieldInputTypes maps are now nested by namespace, so each
    // namespace's own fields appear under their coordinate regardless of the flatten.
    const emailCount = (dts.match(/emailAddress/g) ?? []).length;
    const roleLabelCount = (dts.match(/roleLabel/g) ?? []).length;
    // emailAddress appears in: (1) flattened ContractBase models type, (2) per-namespace auth
    // domain block, (3) FieldOutputTypes[auth], (4) FieldInputTypes[auth].
    expect(emailCount).toBe(4);
    // roleLabel is dropped from the flattened top-level models (public.User loses the flatten)
    // but is now present per-namespace: (1) the per-namespace public domain block,
    // (2) FieldOutputTypes[public], (3) FieldInputTypes[public].
    expect(roleLabelCount).toBe(3);
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
