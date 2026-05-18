import { coreHash } from '@prisma-next/contract/types';
import {
  freezeNode,
  type IRNode,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { MongoCollection } from '../src/ir/mongo-collection';
import { MongoIndex } from '../src/ir/mongo-index';
import { MongoStorage } from '../src/ir/mongo-storage';

const hash = coreHash('h_0');

class TestNamespace extends NamespaceBase {
  readonly kind = 'test-namespace' as const;
  readonly id: string;
  readonly tables: Readonly<Record<string, IRNode>> = Object.freeze({});

  constructor(id: string) {
    super();
    this.id = id;
    freezeNode(this);
  }
}

describe('MongoStorage', () => {
  const defaultNamespace = new TestNamespace('default');

  it('exposes storageHash and namespaces as enumerable fields', () => {
    const storage = new MongoStorage({
      storageHash: hash,
      namespaces: { default: defaultNamespace },
    });
    expect(Object.keys(storage)).toEqual(expect.arrayContaining(['storageHash', 'namespaces']));
  });

  it('normalises plain namespace envelopes with collection tables', () => {
    const storage = new MongoStorage({
      storageHash: hash,
      namespaces: {
        default: {
          id: 'default',
          tables: {
            events: new MongoCollection({
              indexes: [new MongoIndex({ keys: [{ field: 'ts', direction: 1 }] })],
            }),
          },
        },
      },
    });
    expect(storage.namespaces['default']!.tables['events']).toBeInstanceOf(MongoCollection);
  });

  it('preserves namespace instances passed in (target supplies)', () => {
    const auth = new TestNamespace('auth');
    const namespaces = { default: defaultNamespace, auth };
    const storage = new MongoStorage({
      storageHash: hash,
      namespaces,
    });
    expect(storage.namespaces['default']).toBe(defaultNamespace);
    expect(storage.namespaces['auth']).toBe(auth);
  });

  it('is frozen after construction', () => {
    const storage = new MongoStorage({
      storageHash: hash,
      namespaces: { default: defaultNamespace },
    });
    expect(Object.isFrozen(storage)).toBe(true);
  });

  it('defaults to unbound namespace when namespaces omitted', () => {
    const storage = new MongoStorage({ storageHash: hash });
    expect(storage.namespaces[UNBOUND_NAMESPACE_ID]).toBeDefined();
  });
});
