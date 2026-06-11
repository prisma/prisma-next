import { coreHash } from '@prisma-next/contract/types';
import { elementCoordinates, UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { SqliteDatabase, SqliteUnboundDatabase } from '../src/core/sqlite-unbound-database';

const emptyTableInput = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

describe('elementCoordinates with SqliteDatabase', () => {
  it('walks SQLite namespace tables', () => {
    const storage = new SqlStorage({
      storageHash: coreHash('sha256:element-coordinates-sqlite'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: SqliteUnboundDatabase.instance,
        main: new SqliteDatabase({ id: 'main', entries: { table: { users: emptyTableInput } } }),
      },
    });

    const coordinates = [...elementCoordinates(storage)];
    expect(coordinates).toContainEqual({
      plane: 'storage',
      namespaceId: 'main',
      entityKind: 'table',
      entityName: 'users',
    });
  });
});

describe('coordinate-resolution acceptance — every elementCoordinates tuple resolves', () => {
  it('every coordinate from a sqlite storage resolves through entries[entityKind][entityName]', () => {
    const storage = new SqlStorage({
      storageHash: coreHash('sha256:coord-resolution-sqlite'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: SqliteUnboundDatabase.instance,
        main: new SqliteDatabase({
          id: 'main',
          entries: { table: { users: emptyTableInput, posts: emptyTableInput } },
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
