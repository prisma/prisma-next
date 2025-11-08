import { describe, expect, it } from 'vitest';
import { computeCoreHash, computeProfileHash } from '../src/hashing';

describe('hashing', () => {
  it('computes core hash', () => {
    const contract = {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      models: {},
      relations: {},
      storage: { tables: {} },
      extensions: {},
      capabilities: {},
      meta: {},
      sources: {},
    };

    const hash = computeCoreHash(contract);
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
      extensions: {},
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
      extensions: {},
      capabilities: {},
      meta: {},
      sources: {},
    };

    const hash1 = computeCoreHash(contract);
    const hash2 = computeCoreHash(contract);
    expect(hash1).toBe(hash2);
  });
});
