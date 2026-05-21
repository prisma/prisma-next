import { coreHash } from '@prisma-next/contract/types';
import { elementCoordinates } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { MongoStorage } from '../src/ir/mongo-storage';

describe('elementCoordinates with MongoStorage', () => {
  it('walks Mongo namespace collections slot', () => {
    const storage = new MongoStorage({
      storageHash: coreHash('sha256:element-coordinates-mongo'),
      namespaces: {
        app: { id: 'app', collections: { posts: {} } },
      },
    });

    const coordinates = [...elementCoordinates(storage)];
    expect(coordinates).toContainEqual({
      plane: 'storage',
      namespaceId: 'app',
      entityKind: 'collections',
      entityName: 'posts',
    });
  });
});
