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
  it('walks a synthetic Storage literal structurally', () => {
    const storage = {
      namespaces: {
        alpha: {
          id: 'alpha',
          kind: 'test-namespace',
          widgets: { a: {}, b: {} },
          gadgets: { x: {} },
          skippedNull: null,
          skippedScalar: 'ignored',
        },
        beta: {
          id: 'beta',
          kind: 'test-namespace',
          tables: { users: {}, posts: {}, comments: {} },
        },
      },
    };

    const coordinates = [...elementCoordinates(storage)];
    assertStoragePlaneCoordinates(coordinates);

    expect(coordinates).toEqual(
      expect.arrayContaining([
        { plane: 'storage', namespaceId: 'alpha', entityKind: 'widgets', entityName: 'a' },
        { plane: 'storage', namespaceId: 'alpha', entityKind: 'widgets', entityName: 'b' },
        { plane: 'storage', namespaceId: 'alpha', entityKind: 'gadgets', entityName: 'x' },
        { plane: 'storage', namespaceId: 'beta', entityKind: 'tables', entityName: 'users' },
        { plane: 'storage', namespaceId: 'beta', entityKind: 'tables', entityName: 'posts' },
        { plane: 'storage', namespaceId: 'beta', entityKind: 'tables', entityName: 'comments' },
      ]),
    );
    expect(coordinates).toHaveLength(6);
    expect(coordinates.some((c) => c.entityKind === 'id')).toBe(false);
    expect(coordinates.some((c) => c.entityKind === 'skippedNull')).toBe(false);
    expect(coordinates.some((c) => c.entityKind === 'skippedScalar')).toBe(false);
  });
});
