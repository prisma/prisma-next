import type { StorageBase } from '@prisma-next/contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import { describe, expect, it } from 'vitest';
import { type EntityCoordinate, elementCoordinates } from '../src/ir/storage';

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
  it('walks namespace entries slot maps structurally', () => {
    const storage = {
      namespaces: {
        alpha: {
          id: 'alpha',
          kind: 'test-namespace',
          entries: {
            widgets: { a: {}, b: {} },
            gadgets: { x: {} },
            skippedNull: null,
            skippedScalar: 'ignored',
          },
        },
        beta: {
          id: 'beta',
          kind: 'test-namespace',
          entries: {
            table: { users: {}, posts: {}, comments: {} },
          },
        },
      },
    };

    const coordinates = [
      ...elementCoordinates(
        blindCast<Pick<StorageBase, 'namespaces'>, 'synthetic namespace walk fixture'>(storage),
      ),
    ];
    assertStoragePlaneCoordinates(coordinates);

    expect(coordinates).toEqual(
      expect.arrayContaining([
        { plane: 'storage', namespaceId: 'alpha', entityKind: 'widgets', entityName: 'a' },
        { plane: 'storage', namespaceId: 'alpha', entityKind: 'widgets', entityName: 'b' },
        { plane: 'storage', namespaceId: 'alpha', entityKind: 'gadgets', entityName: 'x' },
        { plane: 'storage', namespaceId: 'beta', entityKind: 'table', entityName: 'users' },
        { plane: 'storage', namespaceId: 'beta', entityKind: 'table', entityName: 'posts' },
        { plane: 'storage', namespaceId: 'beta', entityKind: 'table', entityName: 'comments' },
      ]),
    );
    expect(coordinates).toHaveLength(6);
    expect(coordinates.some((c) => c.entityKind === 'id')).toBe(false);
    expect(coordinates.some((c) => c.entityKind === 'skippedNull')).toBe(false);
    expect(coordinates.some((c) => c.entityKind === 'skippedScalar')).toBe(false);
  });
});
