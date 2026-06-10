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
        entries: { table: { users: usersTable('email_addr', 'pg/text@1') } },
      }),
      auth: buildSqlNamespace({
        id: 'auth',
        entries: { table: { users: usersTable('token_col', 'pg/int4@1') } },
      }),
    },
  });
}

describe('codecRefForStorageColumn', () => {
  it('resolves a same-bare-name column strictly within the given namespace', () => {
    const storage = twoNamespaceSameTableName();

    expect(codecRefForStorageColumn(storage, 'public', 'users', 'email_addr')).toEqual({
      codecId: 'pg/text@1',
    });
    expect(codecRefForStorageColumn(storage, 'auth', 'users', 'token_col')).toEqual({
      codecId: 'pg/int4@1',
    });
  });

  it('returns undefined when the column belongs to a different namespace', () => {
    const storage = twoNamespaceSameTableName();

    expect(codecRefForStorageColumn(storage, 'public', 'users', 'token_col')).toBeUndefined();
    expect(codecRefForStorageColumn(storage, 'auth', 'users', 'email_addr')).toBeUndefined();
  });

  it('returns undefined for an unknown column within the namespace', () => {
    const storage = new SqlStorage({
      storageHash: STORAGE_HASH,
      namespaces: {
        public: buildSqlNamespace({
          id: 'public',
          entries: { table: { users: usersTable('email_addr', 'pg/text@1') } },
        }),
      },
    });

    expect(codecRefForStorageColumn(storage, 'public', 'users', 'email_addr')).toEqual({
      codecId: 'pg/text@1',
    });
    expect(codecRefForStorageColumn(storage, 'public', 'users', 'missing')).toBeUndefined();
  });
});
