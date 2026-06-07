import { coreHash } from '@prisma-next/contract/types';
import {
  freezeNode,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { buildMongoNamespace } from '../src/ir/build-mongo-namespace';
import { MongoCollection } from '../src/ir/mongo-collection';
import { MongoIndex } from '../src/ir/mongo-index';
import { MongoStorage } from '../src/ir/mongo-storage';
import { MongoUnboundNamespace } from '../src/ir/mongo-unbound-namespace';

const hash = coreHash('h_0');

class TestNamespace extends NamespaceBase {
  readonly kind = 'test-namespace' as const;
  readonly id: string;
  readonly entries: Readonly<{
    readonly collection: Readonly<Record<string, MongoCollection>>;
  }> = Object.freeze({ collection: Object.freeze({}) });

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

  it('accepts built namespace instances with collections', () => {
    const storage = new MongoStorage({
      storageHash: hash,
      namespaces: {
        default: buildMongoNamespace({
          id: 'default',
          entries: {
            collection: {
              events: new MongoCollection({
                indexes: [new MongoIndex({ keys: [{ field: 'ts', direction: 1 }] })],
              }),
            },
          },
        }),
      },
    });
    expect(storage.namespaces['default']!.entries.collection['events']).toBeInstanceOf(
      MongoCollection,
    );
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

  it('constructs from the unbound namespace singleton alone', () => {
    // `namespaces` is a required field on `MongoStorageInput`, so the
    // empty/omitted case is a type error rather than a runtime throw —
    // this exercises the happy path of an unbound-only storage.
    const storage = new MongoStorage({
      storageHash: hash,
      namespaces: { [UNBOUND_NAMESPACE_ID]: MongoUnboundNamespace.instance },
    });
    expect(storage.namespaces[UNBOUND_NAMESPACE_ID]).toBe(MongoUnboundNamespace.instance);
  });
});
