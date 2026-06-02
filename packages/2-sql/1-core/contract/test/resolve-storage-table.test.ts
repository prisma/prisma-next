import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { buildSqlNamespace } from '../src/ir/build-sql-namespace';
import { SqlStorage } from '../src/ir/sql-storage';
import { StorageTable } from '../src/ir/storage-table';
import { resolveStorageTable } from '../src/resolve-storage-table';

function tableNamed(_name: string): StorageTable {
  return new StorageTable({
    columns: {
      id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  });
}

describe('resolveStorageTable', () => {
  it('prefers the default namespace when the same table name exists in multiple namespaces', () => {
    const publicUser = tableNamed('public-user');
    const authUser = tableNamed('auth-user');
    const storage = new SqlStorage({
      storageHash: 'sha256:test',
      namespaces: {
        auth: buildSqlNamespace({ id: 'auth', tables: { user: authUser } }),
        public: buildSqlNamespace({ id: 'public', tables: { user: publicUser } }),
      },
    });

    const resolved = resolveStorageTable(storage, 'user', {
      defaultNamespaceId: 'public',
    });

    expect(resolved).toEqual({ namespaceId: 'public', table: publicUser });
  });

  it('falls back to a non-default namespace when the table is only declared there', () => {
    const authOnly = tableNamed('auth-only');
    const storage = new SqlStorage({
      storageHash: 'sha256:test',
      namespaces: {
        public: buildSqlNamespace({ id: 'public', tables: {} }),
        auth: buildSqlNamespace({ id: 'auth', tables: { user: authOnly } }),
      },
    });

    const resolved = resolveStorageTable(storage, 'user', {
      defaultNamespaceId: 'public',
    });

    expect(resolved).toEqual({ namespaceId: 'auth', table: authOnly });
  });

  it('resolves within a single namespace contract', () => {
    const users = tableNamed('users');
    const storage = new SqlStorage({
      storageHash: 'sha256:test',
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: buildSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          tables: { users },
        }),
      },
    });

    const resolved = resolveStorageTable(storage, 'users', {
      defaultNamespaceId: UNBOUND_NAMESPACE_ID,
    });

    expect(resolved).toEqual({ namespaceId: UNBOUND_NAMESPACE_ID, table: users });
  });

  it('returns undefined when no namespace declares the table name', () => {
    const storage = new SqlStorage({
      storageHash: 'sha256:test',
      namespaces: {
        public: buildSqlNamespace({ id: 'public', tables: {} }),
      },
    });

    expect(
      resolveStorageTable(storage, 'missing', {
        defaultNamespaceId: 'public',
      }),
    ).toBeUndefined();
  });
});
