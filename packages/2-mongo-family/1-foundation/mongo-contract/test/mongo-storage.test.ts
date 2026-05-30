import { coreHash } from '@prisma-next/contract/types';
import {
  freezeNode,
  getStorageNamespace,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { buildMongoNamespace } from '../src/ir/build-mongo-namespace';
import { MongoCollection } from '../src/ir/mongo-collection';
import { MongoIndex } from '../src/ir/mongo-index';
import type { MongoNamespace } from '../src/ir/mongo-storage';
import { buildMongoStorageInput, MongoStorage } from '../src/ir/mongo-storage';
import { MongoUnboundNamespace } from '../src/ir/mongo-unbound-namespace';

const hash = coreHash('h_0');

class TestNamespace extends NamespaceBase {
  readonly kind = 'test-namespace' as const;
  readonly id: string;
  readonly collections: Readonly<Record<string, MongoCollection>> = Object.freeze({});

  constructor(id: string) {
    super();
    this.id = id;
    freezeNode(this);
  }
}

describe('MongoStorage', () => {
  const defaultNamespace = new TestNamespace('default');

  it('exposes storageHash and namespace ids as enumerable fields', () => {
    const storage = new MongoStorage(
      buildMongoStorageInput({
        storageHash: hash,
        namespaces: { default: defaultNamespace },
      }),
    );
    expect(Object.keys(storage)).toEqual(expect.arrayContaining(['storageHash', 'default']));
  });

  it('accepts built namespace instances with collections', () => {
    const storage = new MongoStorage(
      buildMongoStorageInput({
        storageHash: hash,
        namespaces: {
          default: buildMongoNamespace({
            id: 'default',
            collections: {
              events: new MongoCollection({
                indexes: [new MongoIndex({ keys: [{ field: 'ts', direction: 1 }] })],
              }),
            },
          }),
        },
      }),
    );
    expect(
      (getStorageNamespace(
        storage as unknown as Record<string, unknown>,
        'default',
      ) as MongoNamespace)!.collections['events'],
    ).toBeInstanceOf(MongoCollection);
  });

  it('preserves namespace instances passed in (target supplies)', () => {
    const auth = new TestNamespace('auth');
    const storage = new MongoStorage(
      buildMongoStorageInput({
        storageHash: hash,
        namespaces: { default: defaultNamespace, auth },
      }),
    );
    expect(getStorageNamespace(storage as unknown as Record<string, unknown>, 'default')).toBe(
      defaultNamespace,
    );
    expect(getStorageNamespace(storage as unknown as Record<string, unknown>, 'auth')).toBe(auth);
  });

  it('is frozen after construction', () => {
    const storage = new MongoStorage(
      buildMongoStorageInput({
        storageHash: hash,
        namespaces: { default: defaultNamespace },
      }),
    );
    expect(Object.isFrozen(storage)).toBe(true);
  });

  it('constructs from the unbound namespace singleton alone', () => {
    const storage = new MongoStorage(
      buildMongoStorageInput({
        storageHash: hash,
        namespaces: { [UNBOUND_NAMESPACE_ID]: MongoUnboundNamespace.instance },
      }),
    );
    expect(
      getStorageNamespace(storage as unknown as Record<string, unknown>, UNBOUND_NAMESPACE_ID),
    ).toBe(MongoUnboundNamespace.instance);
  });
});
