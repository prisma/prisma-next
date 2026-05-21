import { coreHash } from '@prisma-next/contract/types';
import { MongoStorage } from '@prisma-next/mongo-contract';
import { SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { type EntityCoordinate, elementCoordinates } from '../src/ir/storage';

const emptyTableInput = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

function assertStoragePlaneCoordinates(coordinates: EntityCoordinate[]): void {
  expect(coordinates.length).toBeGreaterThan(0);
  for (const coordinate of coordinates) {
    expect(coordinate.plane).toBe('storage');
    expect(coordinate.namespaceId).toEqual(expect.any(String));
    expect(coordinate.namespaceId.length).toBeGreaterThan(0);
    expect(coordinate.entityKind).toEqual(expect.any(String));
    expect(coordinate.entityKind.length).toBeGreaterThan(0);
    expect(coordinate.entityName).toEqual(expect.any(String));
    expect(coordinate.entityName.length).toBeGreaterThan(0);
  }
}

describe('elementCoordinates', () => {
  it('yields plane: storage for SQL namespace concretion', () => {
    const storage = new SqlStorage({
      storageHash: coreHash('sha256:element-coordinates-sql'),
      namespaces: {
        app: { id: 'app', tables: { users: emptyTableInput } },
      },
    });

    assertStoragePlaneCoordinates([...elementCoordinates(storage)]);
  });

  it('yields plane: storage for Mongo namespace concretion', () => {
    const storage = new MongoStorage({
      storageHash: coreHash('sha256:element-coordinates-mongo'),
      namespaces: {
        app: { id: 'app', collections: { posts: {} } },
      },
    });

    assertStoragePlaneCoordinates([...elementCoordinates(storage)]);
  });
});
