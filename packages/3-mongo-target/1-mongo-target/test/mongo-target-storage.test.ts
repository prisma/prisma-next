import { coreHash } from '@prisma-next/contract/types';
import { MongoStorageBase } from '@prisma-next/mongo-contract/ir';
import { describe, expect, it } from 'vitest';
import {
  MongoTargetDatabase,
  MongoTargetUnspecifiedDatabase,
} from '../src/core/mongo-target-database';
import { MongoTargetStorage } from '../src/core/mongo-target-storage';

const hash = coreHash('h_0');

describe('MongoTargetStorage', () => {
  it('extends MongoStorageBase (family base)', () => {
    const storage = new MongoTargetStorage({
      storageHash: hash,
      collections: {},
      namespaces: { __unspecified__: MongoTargetUnspecifiedDatabase.instance },
    });
    expect(storage).toBeInstanceOf(MongoStorageBase);
  });

  it('defaults namespaces to the unspecified singleton when omitted', () => {
    const storage = new MongoTargetStorage({ storageHash: hash, collections: {} });
    expect(storage.namespaces['__unspecified__']).toBe(MongoTargetUnspecifiedDatabase.instance);
  });

  it('preserves collections passed in (flat-data shape; IR-class flip is M2 R2)', () => {
    const collections = {
      events: { indexes: [{ keys: [{ field: 'ts', direction: 1 as const }] }] },
    };
    const storage = new MongoTargetStorage({ storageHash: hash, collections });
    expect(storage.collections).toBe(collections);
  });

  it('accepts a named database namespace alongside the unspecified singleton', () => {
    const auth = new MongoTargetDatabase('auth');
    const storage = new MongoTargetStorage({
      storageHash: hash,
      collections: {},
      namespaces: {
        __unspecified__: MongoTargetUnspecifiedDatabase.instance,
        auth,
      },
    });
    expect(storage.namespaces['auth']).toBe(auth);
    expect(storage.namespaces['__unspecified__']).toBe(MongoTargetUnspecifiedDatabase.instance);
  });

  it('is frozen after construction', () => {
    const storage = new MongoTargetStorage({ storageHash: hash, collections: {} });
    expect(Object.isFrozen(storage)).toBe(true);
  });

  // `namespaces` is part of the class API but intentionally not part of
  // the on-disk JSON envelope. Emission walks `Object.entries(contract)`
  // and feeds the result through `JSON.stringify`; a class-form storage
  // re-validated as JSON must round-trip without exposing `namespaces`.
  it('omits namespaces from JSON.stringify (runtime-only class field)', () => {
    const storage = new MongoTargetStorage({
      storageHash: hash,
      collections: { events: { indexes: [] } },
    });
    const parsed = JSON.parse(JSON.stringify(storage)) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('namespaces');
    expect(parsed).toHaveProperty('storageHash');
    expect(parsed).toHaveProperty('collections');
  });

  it('omits namespaces from Object.entries / Object.keys', () => {
    const storage = new MongoTargetStorage({ storageHash: hash, collections: {} });
    expect(Object.keys(storage)).not.toContain('namespaces');
    expect(storage.namespaces['__unspecified__']).toBe(MongoTargetUnspecifiedDatabase.instance);
  });
});
