import { describe, expect, it } from 'vitest';
import type { Contract } from '../src/contract-types';
import type { StorageHashBase } from '../src/types';
import type { StorageValidator } from '../src/validate-contract';
import { ContractValidationError, validateContract } from '../src/validate-contract';

const hash = 'sha256:abc' as StorageHashBase<'sha256:abc'>;

function minimalContract(overrides?: Partial<Contract>): Record<string, unknown> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    roots: { users: 'User' },
    models: {
      User: {
        fields: { id: { nullable: false, codecId: 'pg/int4@1' } },
        relations: {},
        storage: { table: 'user' },
      },
    },
    storage: { storageHash: hash },
    profileHash: 'sha256:test',
    capabilities: {},
    extensionPacks: {},
    meta: {},
    ...overrides,
  };
}

const noopValidator: StorageValidator = () => {};

describe('validateContract', () => {
  it('validates a minimal contract', () => {
    const result = validateContract<Contract>(minimalContract(), noopValidator);
    expect(result.target).toBe('postgres');
    expect(result.roots['users']).toBe('User');
  });

  it('strips schemaVersion from the result', () => {
    const raw = { ...minimalContract(), schemaVersion: '1.0' };
    const result = validateContract<Contract>(raw, noopValidator);
    expect('schemaVersion' in result).toBe(false);
  });

  it('strips _generated from the result', () => {
    const raw = { ...minimalContract(), _generated: { timestamp: '2024-01-01' } };
    const result = validateContract<Contract>(raw, noopValidator);
    expect('_generated' in result).toBe(false);
  });

  it('calls the storage validator', () => {
    const calls: Contract[] = [];
    const storageValidator: StorageValidator = (c) => {
      calls.push(c);
    };
    validateContract<Contract>(minimalContract(), storageValidator);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.target).toBe('postgres');
  });

  it('propagates storage validator errors', () => {
    const storageValidator: StorageValidator = () => {
      throw new Error('bad storage');
    };
    expect(() => validateContract<Contract>(minimalContract(), storageValidator)).toThrow(
      'bad storage',
    );
  });

  it('rejects non-object values with structural phase', () => {
    expect(() => validateContract<Contract>(null, noopValidator)).toThrow(ContractValidationError);
    expect(() => validateContract<Contract>(null, noopValidator)).toThrow(
      'Contract must be a non-null object',
    );
    try {
      validateContract<Contract>(null, noopValidator);
    } catch (e) {
      expect(e).toBeInstanceOf(ContractValidationError);
      expect((e as ContractValidationError).phase).toBe('structural');
      expect((e as ContractValidationError).code).toBe('CONTRACT.VALIDATION_FAILED');
    }
  });

  it('rejects objects missing required fields with structural phase', () => {
    expect(() => validateContract<Contract>({ target: 'postgres' }, noopValidator)).toThrow(
      ContractValidationError,
    );
    try {
      validateContract<Contract>({ target: 'postgres' }, noopValidator);
    } catch (e) {
      expect(e).toBeInstanceOf(ContractValidationError);
      expect((e as ContractValidationError).phase).toBe('structural');
    }
  });

  it('rejects objects with wrong field types with structural phase', () => {
    const raw = { ...minimalContract(), target: 42 };
    expect(() => validateContract<Contract>(raw, noopValidator)).toThrow(ContractValidationError);
    try {
      validateContract<Contract>(raw, noopValidator);
    } catch (e) {
      expect(e).toBeInstanceOf(ContractValidationError);
      expect((e as ContractValidationError).phase).toBe('structural');
    }
  });

  it('runs domain validation with domain phase', () => {
    const raw = minimalContract({ roots: { users: 'NonExistent' } });
    expect(() => validateContract<Contract>(raw, noopValidator)).toThrow(ContractValidationError);
    try {
      validateContract<Contract>(raw, noopValidator);
    } catch (e) {
      expect(e).toBeInstanceOf(ContractValidationError);
      expect((e as ContractValidationError).phase).toBe('domain');
    }
  });

  it('does not reject orphaned models (advisory, not a load-time error)', () => {
    const raw = minimalContract({
      models: {
        User: {
          fields: { id: { nullable: false, codecId: 'pg/int4@1' } },
          relations: {},
          storage: { table: 'user' },
        },
        Orphan: {
          fields: {},
          relations: {},
          storage: {},
        },
      },
    });
    expect(() => validateContract<Contract>(raw, noopValidator)).not.toThrow();
  });
});
