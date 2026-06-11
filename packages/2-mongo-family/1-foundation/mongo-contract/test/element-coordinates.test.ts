import { coreHash } from '@prisma-next/contract/types';
import { elementCoordinates } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { buildMongoNamespace } from '../src/ir/build-mongo-namespace';
import { MongoStorage } from '../src/ir/mongo-storage';

describe('elementCoordinates with MongoStorage', () => {
  it('walks Mongo namespace collections slot', () => {
    const storage = new MongoStorage({
      storageHash: coreHash('sha256:element-coordinates-mongo'),
      namespaces: {
        app: buildMongoNamespace({ id: 'app', entries: { collection: { posts: {} } } }),
      },
    });

    const coordinates = [...elementCoordinates(storage)];
    expect(coordinates).toContainEqual({
      plane: 'storage',
      namespaceId: 'app',
      entityKind: 'collection',
      entityName: 'posts',
    });
  });
});

describe('coordinate-resolution acceptance — every elementCoordinates tuple resolves', () => {
  it('every coordinate from a mongo storage resolves through entries[entityKind][entityName]', () => {
    const storage = new MongoStorage({
      storageHash: coreHash('sha256:coord-resolution-mongo'),
      namespaces: {
        app: buildMongoNamespace({
          id: 'app',
          entries: { collection: { users: {}, posts: {}, comments: {} } },
        }),
        analytics: buildMongoNamespace({
          id: 'analytics',
          entries: { collection: { events: {} } },
        }),
      },
    });

    const coordinates = [...elementCoordinates(storage)];
    expect(coordinates.length).toBeGreaterThan(0);

    for (const { namespaceId, entityKind, entityName } of coordinates) {
      const ns = storage.namespaces[namespaceId];
      expect(ns, `namespace "${namespaceId}" not found`).toBeDefined();
      const kindMap = ns!.entries[entityKind];
      expect(
        kindMap,
        `entries["${entityKind}"] not found in namespace "${namespaceId}"`,
      ).toBeDefined();
      const entity = (kindMap as Record<string, unknown>)[entityName];
      expect(
        entity,
        `entries["${entityKind}"]["${entityName}"] not found in namespace "${namespaceId}"`,
      ).toBeDefined();
    }
  });
});
