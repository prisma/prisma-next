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
});
