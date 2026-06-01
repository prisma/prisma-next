import { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import {
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  LiteralExpr,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { PostgresSchema } from '../../../3-targets/postgres/src/core/postgres-schema';
import { renderLoweredSql } from '../src/core/sql-renderer';
import type { PostgresContract } from '../src/core/types';

const userTableInput = {
  columns: {
    id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
    email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
  },
  uniques: [],
  indexes: [],
  foreignKeys: [],
};

const publicContract = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'sha256:test-profile',
  roots: {},
  capabilities: {},
  extensionPacks: {},
  meta: {},
  storage: new SqlStorage({
    storageHash: 'sha256:test-core-public',
    namespaces: {
      public: new PostgresSchema({
        id: 'public',
        tables: { user: new StorageTable(userTableInput) },
      }),
    },
  }),
  domain: applicationDomainOf({ models: {} }),
} as PostgresContract;

describe('renderLoweredSql namespace qualification', () => {
  it('renders schema-qualified identifiers from the TableSource namespace coordinate', () => {
    const user = TableSource.named('user', undefined, 'public');

    const selectSql = renderLoweredSql(
      SelectAst.from(user).withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))]),
      publicContract,
    ).sql;
    expect(selectSql).toBe('SELECT "user"."id" AS "id" FROM "public"."user"');

    const deleteSql = renderLoweredSql(
      DeleteAst.from(user).withWhere(BinaryExpr.eq(ColumnRef.of('user', 'id'), LiteralExpr.of(1))),
      publicContract,
    ).sql;
    expect(deleteSql).toContain('DELETE FROM "public"."user"');
  });
});
