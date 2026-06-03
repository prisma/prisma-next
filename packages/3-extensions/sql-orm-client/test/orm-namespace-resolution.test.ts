import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { blindCast } from '@prisma-next/utils/casts';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import {
  getColumnToFieldMap,
  getFieldToColumnMap,
  resolveModelTableName,
} from '../src/collection-contract';
import { createMockRuntime } from './helpers';

function model(table: string, fieldColumns: Record<string, string>) {
  const fields: Record<string, { type: { kind: string; codecId: string } }> = {};
  const storageFields: Record<string, { column: string }> = {};
  for (const [field, column] of Object.entries(fieldColumns)) {
    fields[field] = { type: { kind: 'scalar', codecId: 'pg/text@1' } };
    storageFields[field] = { column };
  }
  return { fields, relations: {}, storage: { table, fields: storageFields } };
}

function storageTable(columns: string[]) {
  const cols: Record<string, { codecId: string; nativeType: string; nullable: boolean }> = {};
  for (const column of columns) {
    cols[column] = { codecId: 'pg/text@1', nativeType: 'text', nullable: false };
  }
  return {
    columns: cols,
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
}

// Same bare model name (`User`) in two namespaces, with distinct field→column
// maps and distinct backing tables, so metadata resolution must discriminate
// by namespace coordinate rather than fall back to the default/first-match.
const twoNamespaceContract = blindCast<Contract<SqlStorage>, 'hand-built multi-namespace fixture'>({
  target: 'postgres',
  targetFamily: 'sql',
  capabilities: {},
  domain: {
    namespaces: {
      public: { models: { User: model('users', { id: 'id', email: 'email_addr' }) } },
      auth: { models: { User: model('auth_users', { id: 'id', token: 'token_col' }) } },
    },
  },
  storage: {
    storageHash: 'stub',
    namespaces: {
      public: { id: 'public', tables: { users: storageTable(['id', 'email_addr']) } },
      auth: { id: 'auth', tables: { auth_users: storageTable(['id', 'token_col']) } },
    },
  },
});

describe('namespace-scoped metadata resolution', () => {
  it('resolves field→column maps within the named namespace, discriminating per namespace', () => {
    expect(getFieldToColumnMap(twoNamespaceContract, 'User', 'public')).toEqual({
      id: 'id',
      email: 'email_addr',
    });
    expect(getFieldToColumnMap(twoNamespaceContract, 'User', 'auth')).toEqual({
      id: 'id',
      token: 'token_col',
    });
  });

  it('resolves column→field maps within the named namespace', () => {
    expect(getColumnToFieldMap(twoNamespaceContract, 'User', 'public')).toEqual({
      id: 'id',
      email_addr: 'email',
    });
    expect(getColumnToFieldMap(twoNamespaceContract, 'User', 'auth')).toEqual({
      id: 'id',
      token_col: 'token',
    });
  });

  it('resolves the storage table within the named namespace', () => {
    expect(resolveModelTableName(twoNamespaceContract, 'User', 'public')).toBe('users');
    expect(resolveModelTableName(twoNamespaceContract, 'User', 'auth')).toBe('auth_users');
  });

  it('still throws on flat bare-name metadata access against a multi-namespace contract', () => {
    expect(() => getFieldToColumnMap(twoNamespaceContract, 'User')).toThrow();
  });

  it('a collection constructed with a namespace resolves its own table within that namespace', () => {
    const ctx = {
      runtime: createMockRuntime(),
      context: blindCast<
        ExecutionContext<Contract<SqlStorage>>,
        'stub execution context for metadata resolution'
      >({ contract: twoNamespaceContract }),
    };
    const publicUsers = new Collection(ctx, 'User', { namespaceId: 'public' });
    const authUsers = new Collection(ctx, 'User', { namespaceId: 'auth' });
    expect(publicUsers.tableName).toBe('users');
    expect(authUsers.tableName).toBe('auth_users');
  });
});
