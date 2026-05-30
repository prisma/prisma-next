import { coreHash } from '@prisma-next/contract/types';
import { elementCoordinates } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { buildMongoNamespace } from '../src/ir/build-mongo-namespace';
import { buildMongoStorageInput, MongoStorage } from '../src/ir/mongo-storage';

describe('elementCoordinates with MongoStorage', () => {
  it('walks Mongo namespace collections slot', () => {
    const storage = new MongoStorage(
      buildMongoStorageInput({
        storageHash: coreHash('sha256:element-coordinates-mongo'),
        namespaces: {
          app: buildMongoNamespace({ id: 'app', collections: { posts: {} } }),
        },
      }),
    );

    const coordinates = [...elementCoordinates(storage as unknown as Record<string, unknown>)];
    expect(coordinates).toContainEqual({
      plane: 'storage',
      namespaceId: 'app',
      entityKind: 'collections',
      entityName: 'posts',
    });
  });
});
