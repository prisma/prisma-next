import { describe, expect, it } from 'vitest';
import type { Contract } from '../src/contract-types';
import type { StorageHashBase } from '../src/types';
import type { StorageValidator } from '../src/validate-contract';
import { validateContract } from '../src/validate-contract';

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
    expect(result.warnings).toEqual([]);
  });

  it('strips schemaVersion from the result', () => {
    const raw = { ...minimalContract(), schemaVersion: '1.0' };
    const result = validateContract<Contract>(raw, noopValidator);
    expect('schemaVersion' in result).toBe(false);
  });

  it('strips sources from the result', () => {
    const raw = { ...minimalContract(), sources: { user: { readOnly: false, projection: {} } } };
    const result = validateContract<Contract>(raw, noopValidator);
    expect('sources' in result).toBe(false);
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

  it('rejects non-object values', () => {
    expect(() => validateContract<Contract>(null, noopValidator)).toThrow(
      'Contract must be a non-null object',
    );
    expect(() => validateContract<Contract>('string', noopValidator)).toThrow(
      'Contract must be a non-null object',
    );
  });

  it('rejects objects missing required fields', () => {
    expect(() => validateContract<Contract>({ target: 'postgres' }, noopValidator)).toThrow(
      'Invalid contract structure',
    );
  });

  it('rejects objects with wrong field types', () => {
    const raw = { ...minimalContract(), target: 42 };
    expect(() => validateContract<Contract>(raw, noopValidator)).toThrow(
      'Invalid contract structure',
    );
  });

  it('runs domain validation (catches bad root references)', () => {
    const raw = minimalContract({ roots: { users: 'NonExistent' } });
    expect(() => validateContract<Contract>(raw, noopValidator)).toThrow(
      'does not exist in models',
    );
  });

  it('returns domain validation warnings', () => {
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
    const result = validateContract<Contract>(raw, noopValidator);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Orphaned model')]),
    );
  });
});
