import { describe, expect, it } from 'vitest';

import { computeExecutionHash, computeProfileHash, computeStorageHash } from '../src/hashing';

describe('computeStorageHash', () => {
  it('returns a sha256-prefixed hex string', () => {
    const hash = computeStorageHash({
      target: 'postgres',
      targetFamily: 'sql',
      storage: { tables: {} },
    });
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('produces stable hashes for identical input', () => {
    const args = { target: 'postgres', targetFamily: 'sql', storage: { tables: {} } };
    expect(computeStorageHash(args)).toBe(computeStorageHash(args));
  });

  it('produces different hashes for different storage', () => {
    const base = { target: 'postgres', targetFamily: 'sql' };
    const hash1 = computeStorageHash({ ...base, storage: { tables: {} } });
    const hash2 = computeStorageHash({
      ...base,
      storage: {
        tables: {
          user: {
            columns: { id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false } },
          },
        },
      },
    });
    expect(hash1).not.toBe(hash2);
  });

  it('produces different hashes for different targets', () => {
    const storage = { tables: {} };
    const hash1 = computeStorageHash({ target: 'postgres', targetFamily: 'sql', storage });
    const hash2 = computeStorageHash({ target: 'mysql', targetFamily: 'sql', storage });
    expect(hash1).not.toBe(hash2);
  });

  it('ignores key ordering in storage', () => {
    const base = { target: 'postgres', targetFamily: 'sql' };
    const hash1 = computeStorageHash({
      ...base,
      storage: {
        tables: {
          a: { columns: { x: { codecId: 'pg/text@1', nativeType: 'text' } } },
          b: { columns: { y: { codecId: 'pg/text@1', nativeType: 'text' } } },
        },
      },
    });
    const hash2 = computeStorageHash({
      ...base,
      storage: {
        tables: {
          b: { columns: { y: { codecId: 'pg/text@1', nativeType: 'text' } } },
          a: { columns: { x: { codecId: 'pg/text@1', nativeType: 'text' } } },
        },
      },
    });
    expect(hash1).toBe(hash2);
  });
});

describe('computeProfileHash', () => {
  it('returns a sha256-prefixed hex string', () => {
    const hash = computeProfileHash({
      target: 'postgres',
      targetFamily: 'sql',
      capabilities: { postgres: { jsonAgg: true } },
    });
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('produces different hashes for different capabilities', () => {
    const base = { target: 'postgres', targetFamily: 'sql' };
    const hash1 = computeProfileHash({ ...base, capabilities: {} });
    const hash2 = computeProfileHash({
      ...base,
      capabilities: { postgres: { jsonAgg: true } },
    });
    expect(hash1).not.toBe(hash2);
  });
});

describe('computeExecutionHash', () => {
  it('returns a sha256-prefixed hex string', () => {
    const hash = computeExecutionHash({
      target: 'postgres',
      targetFamily: 'sql',
      execution: {
        mutations: {
          defaults: [
            {
              ref: { table: 'user', column: 'created_at' },
              onCreate: { kind: 'generator', id: 'now' },
            },
          ],
        },
      },
    });
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('produces different hashes for different execution sections', () => {
    const base = { target: 'postgres', targetFamily: 'sql' };
    const hash1 = computeExecutionHash({
      ...base,
      execution: { mutations: { defaults: [] } },
    });
    const hash2 = computeExecutionHash({
      ...base,
      execution: {
        mutations: {
          defaults: [
            {
              ref: { table: 'user', column: 'id' },
              onCreate: { kind: 'generator', id: 'uuid' },
            },
          ],
        },
      },
    });
    expect(hash1).not.toBe(hash2);
  });
});
