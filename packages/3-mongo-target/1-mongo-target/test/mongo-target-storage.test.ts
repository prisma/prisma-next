import { coreHash } from '@prisma-next/contract/types';
import { MongoStorageBase } from '@prisma-next/family-mongo/ir';
import { MongoCollection, MongoIndex } from '@prisma-next/mongo-contract';
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

  it('preserves collections passed in (IR-class instances post M2 R2)', () => {
    const collections = {
      events: new MongoCollection({
        indexes: [new MongoIndex({ keys: [{ field: 'ts', direction: 1 }] })],
      }),
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

  // Stripping runtime-only class API fields from the on-disk envelope
  // is the SPI's responsibility (`MongoTargetContractSerializer.serializeContract`),
  // not the storage class's. The storage class declares `namespaces`
  // as a normal enumerable field so the live class API is uniform;
  // the serializer constructs the persisted JsonObject explicitly.
  it('exposes namespaces as a normal enumerable class field', () => {
    const storage = new MongoTargetStorage({ storageHash: hash, collections: {} });
    expect(Object.keys(storage)).toContain('namespaces');
    expect(storage.namespaces['__unspecified__']).toBe(MongoTargetUnspecifiedDatabase.instance);
  });
});
