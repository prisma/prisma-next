import { computeProfileHash, computeStorageHash } from '@prisma-next/core-control-plane/emission';
import { describe, expect, it } from 'vitest';

describe('hashing', () => {
  it('computes storage hash', () => {
    const contract = {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      models: {},
      relations: {},
      storage: { tables: {} },
      extensionPacks: {},
      capabilities: {},
      meta: {},
      sources: {},
    };

    const hash = computeStorageHash(contract);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('computes profile hash', () => {
    const contract = {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      models: {},
      relations: {},
      storage: { tables: {} },
      extensionPacks: {},
      capabilities: { postgres: { jsonAgg: true } },
      meta: {},
      sources: {},
    };

    const hash = computeProfileHash(contract);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('produces stable hashes for identical input', () => {
    const contract = {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      models: {},
      relations: {},
      storage: { tables: {} },
      extensionPacks: {},
      capabilities: {},
      meta: {},
      sources: {},
    };

    const hash1 = computeStorageHash(contract);
    const hash2 = computeStorageHash(contract);
    expect(hash1).toBe(hash2);
  });
});
