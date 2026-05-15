import { coreHash } from '@prisma-next/contract/types';
import { freezeNode, NamespaceBase } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { MongoCollection } from '../src/ir/mongo-collection';
import { MongoIndex } from '../src/ir/mongo-index';
import { MongoStorage } from '../src/ir/mongo-storage';

const hash = coreHash('h_0');

class TestNamespace extends NamespaceBase {
  readonly kind = 'test-namespace' as const;
  readonly id: string;

  constructor(id: string) {
    super();
    this.id = id;
    freezeNode(this);
  }
}

describe('MongoStorage', () => {
  const defaultNamespace = new TestNamespace('default');

  it('exposes storageHash, collections, and namespaces as enumerable fields', () => {
    const storage = new MongoStorage({
      storageHash: hash,
      collections: {},
      namespaces: { default: defaultNamespace },
    });
    expect(Object.keys(storage)).toEqual(
      expect.arrayContaining(['storageHash', 'collections', 'namespaces']),
    );
  });

  it('preserves collections passed in (IR-class instances)', () => {
    const collections = {
      events: new MongoCollection({
        indexes: [new MongoIndex({ keys: [{ field: 'ts', direction: 1 }] })],
      }),
    };
    const storage = new MongoStorage({
      storageHash: hash,
      collections,
      namespaces: { default: defaultNamespace },
    });
    expect(storage.collections).toBe(collections);
  });

  it('preserves namespaces passed in (target supplies)', () => {
    const auth = new TestNamespace('auth');
    const namespaces = { default: defaultNamespace, auth };
    const storage = new MongoStorage({
      storageHash: hash,
      collections: {},
      namespaces,
    });
    expect(storage.namespaces).toBe(namespaces);
  });

  it('is frozen after construction', () => {
    const storage = new MongoStorage({
      storageHash: hash,
      collections: {},
      namespaces: { default: defaultNamespace },
    });
    expect(Object.isFrozen(storage)).toBe(true);
  });
});
