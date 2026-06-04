import {
  buildSqlNamespace,
  SqlStorage,
  type SqlStorage as SqlStorageType,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import { describe, expect, it } from 'vitest';
import { codecRefForStorageColumn } from '../src/codec-ref-for-column';

const STORAGE_HASH = blindCast<SqlStorageType['storageHash'], 'test storage hash literal'>(
  'sha256:test',
);

function usersTable(columnName: string, codecId: string): StorageTable {
  return new StorageTable({
    columns: {
      id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
      [columnName]: { codecId, nativeType: 'text', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  });
}

function twoNamespaceSameTableName(): SqlStorage {
  return new SqlStorage({
    storageHash: STORAGE_HASH,
    namespaces: {
      public: buildSqlNamespace({
        id: 'public',
        tables: { users: usersTable('email_addr', 'pg/text@1') },
      }),
      auth: buildSqlNamespace({
        id: 'auth',
        tables: { users: usersTable('token_col', 'pg/int4@1') },
      }),
    },
  });
}

describe('codecRefForStorageColumn', () => {
  it('resolves a same-bare-name column strictly within the given namespace', () => {
    const storage = twoNamespaceSameTableName();

    expect(codecRefForStorageColumn(storage, 'users', 'email_addr', 'public')).toEqual({
      codecId: 'pg/text@1',
    });
    expect(codecRefForStorageColumn(storage, 'users', 'token_col', 'auth')).toEqual({
      codecId: 'pg/int4@1',
    });
  });

  it('returns undefined when the column belongs to a different namespace', () => {
    const storage = twoNamespaceSameTableName();

    expect(codecRefForStorageColumn(storage, 'users', 'token_col', 'public')).toBeUndefined();
    expect(codecRefForStorageColumn(storage, 'users', 'email_addr', 'auth')).toBeUndefined();
  });

  it('throws naming the candidate namespaces for an ambiguous bare table name', () => {
    const storage = twoNamespaceSameTableName();

    expect(() => codecRefForStorageColumn(storage, 'users', 'id')).toThrow(/ambiguous/i);
    expect(() => codecRefForStorageColumn(storage, 'users', 'id')).toThrow(/auth/);
    expect(() => codecRefForStorageColumn(storage, 'users', 'id')).toThrow(/public/);
  });

  it('resolves a unique bare table name without a coordinate', () => {
    const storage = new SqlStorage({
      storageHash: STORAGE_HASH,
      namespaces: {
        public: buildSqlNamespace({
          id: 'public',
          tables: { users: usersTable('email_addr', 'pg/text@1') },
        }),
      },
    });

    expect(codecRefForStorageColumn(storage, 'users', 'email_addr')).toEqual({
      codecId: 'pg/text@1',
    });
    expect(codecRefForStorageColumn(storage, 'users', 'missing')).toBeUndefined();
  });
});
