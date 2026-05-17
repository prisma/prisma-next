import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { col, pk } from '../src/factories';
import {
  countAllTables,
  findTableByCoord,
  findTableByName,
  iterateAllTables,
  iterateTablesWithCoords,
  listAllTableNames,
  SqlStorage,
} from '../src/ir/sql-storage';
import { StorageTable } from '../src/ir/storage-table';

const sha = 'sha256:test' as const;
const id = col('uuid', 'pg/uuid@1');

function makeUserTable(namespaceId: string): StorageTable {
  return new StorageTable({
    columns: { id },
    primaryKey: pk('id'),
    uniques: [],
    indexes: [],
    foreignKeys: [],
    namespaceId,
  });
}

describe('SqlStorage — same-named tables across namespaces', () => {
  it('keeps both auth.User and public.User after construction (FR15)', () => {
    const storage = new SqlStorage({
      storageHash: sha as SqlStorage['storageHash'],
      tables: {
        auth: { User: makeUserTable('auth') },
        public: { User: makeUserTable('public') },
      },
    });

    const authUser = findTableByCoord(storage, 'auth', 'User');
    const publicUser = findTableByCoord(storage, 'public', 'User');

    expect(authUser).toBeDefined();
    expect(publicUser).toBeDefined();
    expect(authUser).not.toBe(publicUser);
    expect(authUser?.namespaceId).toBe('auth');
    expect(publicUser?.namespaceId).toBe('public');
  });

  it('reports both tables through nested-coord iteration', () => {
    const storage = new SqlStorage({
      storageHash: sha as SqlStorage['storageHash'],
      tables: {
        auth: { User: makeUserTable('auth') },
        public: { User: makeUserTable('public') },
      },
    });

    const coords = [...iterateTablesWithCoords(storage)].map(({ namespaceId, name }) => ({
      namespaceId,
      name,
    }));
    expect(coords).toHaveLength(2);
    expect(coords).toContainEqual({ namespaceId: 'auth', name: 'User' });
    expect(coords).toContainEqual({ namespaceId: 'public', name: 'User' });

    expect([...iterateAllTables(storage)]).toHaveLength(2);
    expect(countAllTables(storage)).toBe(2);
    expect(listAllTableNames(storage)).toEqual(['User', 'User']);
  });

  it('findTableByName throws when the same name lives in multiple namespaces', () => {
    const storage = new SqlStorage({
      storageHash: sha as SqlStorage['storageHash'],
      tables: {
        auth: { User: makeUserTable('auth') },
        public: { User: makeUserTable('public') },
      },
    });

    expect(() => findTableByName(storage, 'User')).toThrow(/multiple namespaces/);
  });

  it('rejects nested input where the back-pointer disagrees with the enclosing key', () => {
    expect(
      () =>
        new SqlStorage({
          storageHash: sha as SqlStorage['storageHash'],
          tables: {
            auth: { User: makeUserTable('public') },
          },
        }),
    ).toThrow(/back-pointer/);
  });

  it('rejects non-canonical flat input (table values keyed at the namespace level)', () => {
    expect(
      () =>
        new SqlStorage({
          storageHash: sha as SqlStorage['storageHash'],
          // The constructor accepts only the FR15 nested-by-namespace
          // shape; a top-level `{ tableName: StorageTable }` looks like a
          // namespace bucket but the value is a `StorageTable`, surfacing
          // the canonical-shape diagnostic.
          tables: {
            User: makeUserTable(UNBOUND_NAMESPACE_ID),
          } as unknown as Record<string, Record<string, StorageTable>>,
        }),
    ).toThrow(/namespace bucket|flat/);
  });

  it('single-namespace canonical input stores tables under the namespace key', () => {
    const storage = new SqlStorage({
      storageHash: sha as SqlStorage['storageHash'],
      tables: {
        [UNBOUND_NAMESPACE_ID]: {
          User: makeUserTable(UNBOUND_NAMESPACE_ID),
          Post: makeUserTable(UNBOUND_NAMESPACE_ID),
        },
      },
    });

    expect(Object.keys(storage.tables)).toEqual([UNBOUND_NAMESPACE_ID]);
    const bucket = storage.tables[UNBOUND_NAMESPACE_ID];
    expect(bucket).toBeDefined();
    expect(Object.keys(bucket!).sort()).toEqual(['Post', 'User']);
  });

  it('multi-namespace tables are keyed under their respective namespaces', () => {
    const storage = new SqlStorage({
      storageHash: sha as SqlStorage['storageHash'],
      tables: {
        auth: { User: makeUserTable('auth') },
        public: { User: makeUserTable('public'), Account: makeUserTable('public') },
      },
    });

    expect(Object.keys(storage.tables).sort()).toEqual(['auth', 'public']);
    expect(Object.keys(storage.tables['auth']!)).toEqual(['User']);
    expect(Object.keys(storage.tables['public']!).sort()).toEqual(['Account', 'User']);
  });
});
