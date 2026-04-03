import { describe, expect, it } from 'vitest';

import { createContract, createSqlContract } from '../src/contract-factories';

describe('createContract', () => {
  it('creates a contract with defaults', () => {
    const contract = createContract();
    expect(contract.target).toBe('postgres');
    expect(contract.targetFamily).toBe('sql');
    expect(contract.roots).toEqual({});
    expect(contract.models).toEqual({});
    expect(contract.capabilities).toEqual({});
    expect(contract.extensionPacks).toEqual({});
    expect(contract.meta).toEqual({});
    expect(contract.storage.storageHash).toMatch(/^sha256:/);
    expect(contract.profileHash).toMatch(/^sha256:/);
  });

  it('respects overrides', () => {
    const contract = createContract({
      target: 'mysql',
      targetFamily: 'sql',
      capabilities: { mysql: { json: true } },
      roots: { users: 'User' },
    });
    expect(contract.target).toBe('mysql');
    expect(contract.capabilities).toEqual({ mysql: { json: true } });
    expect(contract.roots).toEqual({ users: 'User' });
  });

  it('computes different storageHash for different storage', () => {
    const c1 = createContract({ storage: { tables: {} } });
    const c2 = createContract({
      storage: { tables: { user: { columns: {} } } },
    });
    expect(c1.storage.storageHash).not.toBe(c2.storage.storageHash);
  });
});

describe('createSqlContract', () => {
  it('defaults to postgres/sql', () => {
    const contract = createSqlContract();
    expect(contract.target).toBe('postgres');
    expect(contract.targetFamily).toBe('sql');
  });

  it('includes storage with tables', () => {
    const contract = createSqlContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            },
          },
        },
      },
    });
    const tables = contract.storage.tables as Record<string, unknown>;
    expect(tables).toHaveProperty('user');
    expect(contract.storage.storageHash).toMatch(/^sha256:/);
  });
});
