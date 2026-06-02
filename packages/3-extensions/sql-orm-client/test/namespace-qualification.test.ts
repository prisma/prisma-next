import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { Contract, ContractModelBase } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlStorage as SqlStorageType } from '@prisma-next/sql-contract/types';
import { SqlStorage, type SqlStorageInput, StorageTable } from '@prisma-next/sql-contract/types';
import type { TableSource } from '@prisma-next/sql-relational-core/ast';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { PostgresSchema } from '../../../3-targets/3-targets/postgres/src/core/postgres-schema';
import { SqliteDatabase } from '../../../3-targets/3-targets/sqlite/src/core/sqlite-unbound-database';
import type { PostgresContract } from '../../../3-targets/6-adapters/postgres/src/core/types';
import { compileDeleteCount, compileInsertReturning, compileSelect } from '../src/query-plan';
import { resolveDomainModelForContract } from '../src/storage-resolution';
import { emptyState } from '../src/types';

const PUBLIC_NAMESPACE_ID = 'public';

const userModel = {
  fields: {
    id: { type: { kind: 'scalar', name: 'Int' } },
    email: { type: { kind: 'scalar', name: 'String' } },
  },
  storage: { table: 'users' },
} as unknown as ContractModelBase;

const usersTableInput = {
  columns: {
    id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
    email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
  },
  uniques: [],
  indexes: [],
  foreignKeys: [],
};

const publicPostgresContract = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'sha256:test-profile',
  roots: {},
  capabilities: { returning: { enabled: true } },
  extensionPacks: {},
  meta: {},
  storage: new SqlStorage({
    storageHash: 'sha256:test-core-public-orm',
    namespaces: {
      [PUBLIC_NAMESPACE_ID]: new PostgresSchema({
        id: PUBLIC_NAMESPACE_ID,
        tables: { users: new StorageTable(usersTableInput) },
      }),
    },
  } as unknown as SqlStorageInput<'sha256:test-core-public-orm'>),
  domain: applicationDomainOf({
    namespaceId: PUBLIC_NAMESPACE_ID,
    models: { User: userModel },
  }),
} as unknown as PostgresContract;

describe('ORM namespace qualification', () => {
  it('resolves models default-namespace-first without throwing on multi-domain namespaces', () => {
    const contract = {
      ...publicPostgresContract,
      domain: {
        namespaces: {
          public: { models: { User: userModel } },
          auth: { models: { User: { ...userModel, storage: { table: 'users' } } } },
        },
      },
    } as Contract<SqlStorageType>;

    const resolved = resolveDomainModelForContract(contract, 'User');
    expect(resolved?.namespaceId).toBe('public');
    expect(() => compileSelect(contract, 'users', emptyState(), 'User')).not.toThrow();
  });

  it('stamps public on TableSource for select, insert, and delete plans', () => {
    const selectPlan = compileSelect(publicPostgresContract, 'users', emptyState(), 'User');
    expect((selectPlan.ast as { from: TableSource }).from.namespaceId).toBe('public');

    const insertPlan = compileInsertReturning(
      publicPostgresContract,
      'users',
      [{ id: 1, email: 'a@example.com' }],
      ['id', 'email'],
    );
    expect((insertPlan.ast as { table: TableSource }).table.namespaceId).toBe('public');

    const deletePlan = compileDeleteCount(publicPostgresContract, 'users', []);
    expect((deletePlan.ast as { table: TableSource }).table.namespaceId).toBe('public');
  });

  it('renders schema-qualified SQL for Postgres via the adapter lower path', () => {
    const adapter = createPostgresAdapter();
    const selectPlan = compileSelect(publicPostgresContract, 'users', {
      ...emptyState(),
      selectedFields: ['id', 'email'],
    });
    const selectSql = adapter.lower(selectPlan.ast, {
      contract: publicPostgresContract,
      params: selectPlan.params,
    }).sql;
    expect(selectSql).toContain('FROM "public"."users"');

    const insertPlan = compileInsertReturning(
      publicPostgresContract,
      'users',
      [{ id: 1, email: 'a@example.com' }],
      ['id', 'email'],
    );
    const insertSql = adapter.lower(insertPlan.ast, {
      contract: publicPostgresContract,
      params: insertPlan.params,
    }).sql;
    expect(insertSql).toContain('INSERT INTO "public"."users"');
  });

  it('stamps the unbound namespace coordinate for SQLite contracts', () => {
    const sqliteContract = {
      target: 'sqlite',
      targetFamily: 'sql',
      profileHash: 'sha256:test-profile',
      roots: {},
      capabilities: {},
      extensionPacks: {},
      meta: {},
      storage: new SqlStorage({
        storageHash: 'sha256:test-core-sqlite-orm',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: new SqliteDatabase({
            id: UNBOUND_NAMESPACE_ID,
            tables: {
              users: new StorageTable({
                columns: {
                  id: { codecId: 'sqlite/integer@1', nativeType: 'integer', nullable: false },
                  email: { codecId: 'sqlite/text@1', nativeType: 'text', nullable: false },
                },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              }),
            },
          }),
        },
      } as unknown as SqlStorageInput<'sha256:test-core-sqlite-orm'>),
      domain: applicationDomainOf({
        namespaceId: UNBOUND_NAMESPACE_ID,
        models: { User: userModel },
      }),
    } as unknown as Contract<SqlStorageType>;

    const selectPlan = compileSelect(sqliteContract, 'users', {
      ...emptyState(),
      selectedFields: ['id'],
    });
    expect((selectPlan.ast as { from: TableSource }).from.namespaceId).toBe(UNBOUND_NAMESPACE_ID);
  });
});
