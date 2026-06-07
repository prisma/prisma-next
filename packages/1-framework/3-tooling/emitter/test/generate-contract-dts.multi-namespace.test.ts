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
    // The flattened top-level models type includes auth's User (emailAddress field).
    // public's User (roleLabel field) is dropped from the flatten — roleLabel must not
    // appear in the flattened section. It will appear in the per-namespace public block,
    // so we check that emailAddress is present (it must appear twice: in the flatten and
    // in the per-namespace auth block) and that roleLabel only appears once (per-namespace
    // public block only, not in the flattened top-level models).
    const emailCount = (dts.match(/emailAddress/g) ?? []).length;
    const roleLabelCount = (dts.match(/roleLabel/g) ?? []).length;
    // emailAddress appears in: (1) flattened ContractBase models type, (2) per-namespace auth
    // block, (3) FieldOutputTypes, (4) FieldInputTypes — because auth.User wins the flatten.
    expect(emailCount).toBe(4);
    // roleLabel appears only in the per-namespace public block; it is NOT promoted into the
    // flattened models type, FieldOutputTypes, or FieldInputTypes — public.User was dropped.
    expect(roleLabelCount).toBe(1);
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
