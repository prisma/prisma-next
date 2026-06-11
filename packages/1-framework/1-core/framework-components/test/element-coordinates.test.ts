import type { StorageBase } from '@prisma-next/contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import { describe, expect, it } from 'vitest';
import { type EntityCoordinate, elementCoordinates, entityAt } from '../src/ir/storage';

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

describe('entityAt', () => {
  const storage = blindCast<Pick<StorageBase, 'namespaces'>, 'synthetic storage fixture'>({
    namespaces: {
      public: {
        id: 'public',
        entries: { table: { users: { name: 'users' }, posts: { name: 'posts' } } },
      },
      auth: {
        id: 'auth',
        entries: {
          table: { identities: { name: 'identities' } },
          valueSet: { Role: { name: 'Role' } },
        },
      },
    },
  });

  it('resolves a known coordinate', () => {
    const entity = entityAt(storage, {
      namespaceId: 'public',
      entityKind: 'table',
      entityName: 'users',
    });
    expect(entity).toEqual({ name: 'users' });
  });

  it('resolves across kinds', () => {
    const entity = entityAt(storage, {
      namespaceId: 'auth',
      entityKind: 'valueSet',
      entityName: 'Role',
    });
    expect(entity).toEqual({ name: 'Role' });
  });

  it('returns undefined for unknown namespace', () => {
    expect(
      entityAt(storage, { namespaceId: 'missing', entityKind: 'table', entityName: 'users' }),
    ).toBeUndefined();
  });

  it('returns undefined for unknown entityKind', () => {
    expect(
      entityAt(storage, { namespaceId: 'public', entityKind: 'collection', entityName: 'users' }),
    ).toBeUndefined();
  });

  it('returns undefined for unknown entityName', () => {
    expect(
      entityAt(storage, { namespaceId: 'public', entityKind: 'table', entityName: 'missing' }),
    ).toBeUndefined();
  });
});
