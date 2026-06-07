import type { StorageHashBase } from '@prisma-next/contract/types';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
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
import { PostgresSchema } from '@prisma-next/target-postgres/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
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

const emptyLookup: CodecLookup = {
  get: () => undefined,
  targetTypesFor: () => undefined,
  metaFor: () => undefined,
  renderOutputTypeFor: () => undefined,
  parsePslLiteralFor: (id) => ({ ok: false as const, error: `codec "${id}" is not registered` }),
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
    storageHash: 'sha256:test-core-public' as StorageHashBase<'sha256:test-core-public'>,
    namespaces: {
      public: new PostgresSchema({
        id: 'public',
        entries: { table: { user: new StorageTable(userTableInput) }, type: {} },
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
      emptyLookup,
    ).sql;
    expect(selectSql).toBe('SELECT "user"."id" AS "id" FROM "public"."user"');

    const deleteSql = renderLoweredSql(
      DeleteAst.from(user).withWhere(BinaryExpr.eq(ColumnRef.of('user', 'id'), LiteralExpr.of(1))),
      publicContract,
      emptyLookup,
    ).sql;
    expect(deleteSql).toContain('DELETE FROM "public"."user"');
  });
});
