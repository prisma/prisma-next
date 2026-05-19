import { computeProfileHash, computeStorageHash } from '@prisma-next/contract/hashing';
import { describe, expect, it } from 'vitest';

const emptyNamespacedStorage = () => ({
  namespaces: {
    __unbound__: { id: '__unbound__' as const, tables: {} },
  },
});

describe('hashing', () => {
  it('computes storage hash', () => {
    const hash = computeStorageHash({
      targetFamily: 'sql',
      target: 'postgres',
      storage: emptyNamespacedStorage(),
    });
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('computes profile hash', () => {
    const hash = computeProfileHash({
      targetFamily: 'sql',
      target: 'postgres',
      capabilities: { postgres: { jsonAgg: true } },
    });
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('produces stable hashes for identical input', () => {
    const args = {
      targetFamily: 'sql',
      target: 'postgres',
      storage: emptyNamespacedStorage(),
    };

    const hash1 = computeStorageHash(args);
    const hash2 = computeStorageHash(args);
    expect(hash1).toBe(hash2);
  });
});
