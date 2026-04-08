import { describe, expect, it } from 'vitest';
import type { Contract } from '../src/contract-types';
import type { ContractModel } from '../src/domain-types';
import type { ExecutionHashBase, ProfileHashBase, StorageHashBase } from '../src/types';

describe('unified contract types', () => {
  describe('ContractModel', () => {
    it('preserves polymorphism fields (discriminator, variants, base, owner)', () => {
      const model: ContractModel = {
        fields: { type: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } } },
        relations: {},
        storage: {},
        discriminator: { field: 'type' },
        variants: { Special: { value: 'special' } },
        owner: 'Parent',
      };
      expect(model.discriminator?.field).toBe('type');
      expect(model.owner).toBe('Parent');
    });
  });

  describe('StorageBase', () => {
    it('carries branded storageHash', () => {
      const hash = 'sha256:abc123' as StorageHashBase<'sha256:abc123'>;
      const storage = { storageHash: hash };
      expect(storage.storageHash).toBe('sha256:abc123');
    });
  });

  describe('Contract<TStorage, TModels>', () => {
    it('accepts a full contract value', () => {
      const hash = 'sha256:abc123' as StorageHashBase<'sha256:abc123'>;
      const profHash = 'sha256:prof' as ProfileHashBase<'sha256:prof'>;
      const contract: Contract = {
        target: 'postgres',
        targetFamily: 'sql',
        roots: { users: 'User' },
        models: {
          User: {
            fields: { id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } } },
            relations: {},
            storage: {},
          },
        },
        storage: { storageHash: hash },
        capabilities: {},
        extensionPacks: {},
        meta: {},
        profileHash: profHash,
      };
      expect(contract.target).toBe('postgres');
      expect(contract.roots['users']).toBe('User');
    });

    it('accepts optional execution', () => {
      const hash = 'sha256:abc123' as StorageHashBase<'sha256:abc123'>;
      const execHash = 'sha256:exec456' as ExecutionHashBase<'sha256:exec456'>;
      const profHash = 'sha256:prof789' as ProfileHashBase<'sha256:prof789'>;
      const contract: Contract = {
        target: 'postgres',
        targetFamily: 'sql',
        roots: {},
        models: {},
        storage: { storageHash: hash },
        capabilities: {},
        extensionPacks: {},
        meta: {},
        execution: {
          executionHash: execHash,
          mutations: { defaults: [] },
        },
        profileHash: profHash,
      };
      expect(contract.execution?.executionHash).toBe('sha256:exec456');
      expect(contract.profileHash).toBe('sha256:prof789');
    });
  });

  describe('framework consumer compatibility', () => {
    it('framework code reads domain fields from Contract (opaque storage)', () => {
      function frameworkConsumer(contract: Contract): string[] {
        return Object.entries(contract.models).map(([name, model]) => {
          const fieldCount = Object.keys(model.fields).length;
          return `${name}: ${fieldCount} fields`;
        });
      }

      const hash = 'sha256:abc123' as StorageHashBase<'sha256:abc123'>;
      const profHash = 'sha256:prof' as ProfileHashBase<'sha256:prof'>;
      const contract: Contract = {
        target: 'postgres',
        targetFamily: 'sql',
        roots: { users: 'User' },
        models: {
          User: {
            fields: {
              id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
              email: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
            },
            relations: {},
            storage: {},
          },
        },
        storage: { storageHash: hash },
        capabilities: {},
        extensionPacks: {},
        meta: {},
        profileHash: profHash,
      };

      const result = frameworkConsumer(contract);
      expect(result).toEqual(['User: 2 fields']);
    });
  });
});
