import type { Contract } from '@prisma-next/contract/types';
import {
  buildSqlNamespace,
  SqlStorage,
  type SqlStorage as SqlStorageType,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import { describe, expect, it } from 'vitest';
import {
  requireStorageTableForContract,
  storageTableForContract,
  tableSourceForContract,
} from '../src/storage-resolution';

const STORAGE_HASH = blindCast<SqlStorageType['storageHash'], 'test storage hash literal'>(
  'sha256:test',
);

function usersTable(columnName: string): StorageTable {
  return new StorageTable({
    columns: {
      id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
      [columnName]: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  });
}

function contractWith(storage: SqlStorageType): Contract<SqlStorageType> {
  return blindCast<
    Contract<SqlStorageType>,
    'minimal contract wrapping storage for resolver tests'
  >({ storage });
}

function twoNamespaceSameTableName(): Contract<SqlStorageType> {
  return contractWith(
    new SqlStorage({
      storageHash: STORAGE_HASH,
      namespaces: {
        public: buildSqlNamespace({ id: 'public', tables: { users: usersTable('email_addr') } }),
        auth: buildSqlNamespace({ id: 'auth', tables: { users: usersTable('token_col') } }),
      },
    }),
  );
}

describe('storage-resolution coordinate-aware lookups', () => {
  it('enumerates columns strictly within the given namespace', () => {
    const contract = twoNamespaceSameTableName();

    expect(Object.keys(storageTableForContract(contract, 'users', 'public').columns)).toEqual([
      'id',
      'email_addr',
    ]);
    expect(Object.keys(storageTableForContract(contract, 'users', 'auth').columns)).toEqual([
      'id',
      'token_col',
    ]);
  });

  it('resolves the namespace coordinate strictly', () => {
    const contract = twoNamespaceSameTableName();

    expect(requireStorageTableForContract(contract, 'users', 'auth').namespaceId).toBe('auth');
    expect(tableSourceForContract(contract, 'users', undefined, 'public').namespaceId).toBe(
      'public',
    );
  });

  it('throws naming the candidate namespaces for an ambiguous bare table name', () => {
    const contract = twoNamespaceSameTableName();

    expect(() => storageTableForContract(contract, 'users')).toThrow(/ambiguous/i);
    expect(() => storageTableForContract(contract, 'users')).toThrow(/auth/);
    expect(() => storageTableForContract(contract, 'users')).toThrow(/public/);
  });

  it('resolves a unique bare table name without a coordinate', () => {
    const contract = contractWith(
      new SqlStorage({
        storageHash: STORAGE_HASH,
        namespaces: {
          public: buildSqlNamespace({ id: 'public', tables: { users: usersTable('email_addr') } }),
        },
      }),
    );

    expect(Object.keys(storageTableForContract(contract, 'users').columns)).toEqual([
      'id',
      'email_addr',
    ]);
  });
});
