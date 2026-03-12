import { validateContract } from '@prisma-next/sql-contract/validate';
import {
  AggregateExpr,
  BinaryExpr,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  InsertAst,
  InsertOnConflict,
  JsonObjectExpr,
  LiteralExpr,
  ParamRef,
  ProjectionItem,
  QueryAst,
  SelectAst,
  SubqueryExpr,
  TableSource,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../src/core/adapter';
import type { PostgresContract } from '../src/core/types';

const contract = validateContract<PostgresContract>({
  target: 'postgres',
  targetFamily: 'sql',
  storageHash: 'sha256:test-core',
  profileHash: 'sha256:test-profile',
  storage: {
    tables: {
      user: {
        columns: {
          id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
          email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          createdAt: { codecId: 'pg/timestamptz@1', nativeType: 'timestamptz', nullable: false },
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
      post: {
        columns: {
          id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
          userId: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
          title: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    },
  },
  models: {},
  relations: {},
  mappings: {},
});

class UnsupportedAst extends QueryAst {
  override collectRefs() {
    return { tables: [], columns: [] };
  }
}

describe('Postgres adapter', () => {
  const adapter = createPostgresAdapter();

  it('lowers rich select statements with aggregates, JSON, and subqueries', () => {
    const subquery = SelectAst.from(TableSource.named('post'))
      .withProject([ProjectionItem.of('id', ColumnRef.of('post', 'id'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'userId'), ColumnRef.of('user', 'id')));
    const ast = SelectAst.from(TableSource.named('user'))
      .withProject([
        ProjectionItem.of('id', ColumnRef.of('user', 'id')),
        ProjectionItem.of(
          'payload',
          JsonObjectExpr.fromEntries([
            JsonObjectExpr.entry('email', ColumnRef.of('user', 'email')),
            JsonObjectExpr.entry('count', AggregateExpr.count()),
          ]),
        ),
        ProjectionItem.of('firstPostId', SubqueryExpr.of(subquery)),
      ])
      .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'email'), LiteralExpr.of('a@example.com')))
      .withOrderBy([]);

    const lowered = adapter.lower(ast, { contract, params: [] });

    expect(lowered.body.sql).toContain('json_build_object');
    expect(lowered.body.sql).toContain(
      '(SELECT "post"."id" AS "id" FROM "post" WHERE "post"."userId" = "user"."id") AS "firstPostId"',
    );
    expect(lowered.body.sql).toContain(`WHERE "user"."email" = 'a@example.com'`);
  });

  it('lowers insert, update, and delete statements with returning clauses', () => {
    const insertAst = InsertAst.into(TableSource.named('user'))
      .withRows([
        { id: ParamRef.of(1, 'id'), email: ParamRef.of(2, 'email') },
        { id: ParamRef.of(3, 'id2'), email: new DefaultValueExpr() },
      ])
      .withOnConflict(
        InsertOnConflict.on([ColumnRef.of('user', 'email')]).doUpdateSet({
          email: ColumnRef.of('excluded', 'email'),
        }),
      )
      .withReturning([ColumnRef.of('user', 'id')]);
    const updateAst = UpdateAst.table(TableSource.named('user'))
      .withSet({ email: ParamRef.of(1, 'email') })
      .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'id'), ParamRef.of(2, 'id')))
      .withReturning([ColumnRef.of('user', 'email')]);
    const deleteAst = DeleteAst.from(TableSource.named('user'))
      .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'id'), ParamRef.of(1, 'id')))
      .withReturning([ColumnRef.of('user', 'id')]);

    expect(
      adapter.lower(insertAst, { contract, params: [1, 'a@example.com', 2] }).body.sql,
    ).toContain('ON CONFLICT ("email") DO UPDATE SET "email" = excluded."email"');
    expect(adapter.lower(updateAst, { contract, params: ['b@example.com', 1] }).body.sql).toBe(
      'UPDATE "user" SET "email" = $1 WHERE "user"."id" = $2 RETURNING "user"."email"',
    );
    expect(adapter.lower(deleteAst, { contract, params: [1] }).body.sql).toBe(
      'DELETE FROM "user" WHERE "user"."id" = $1 RETURNING "user"."id"',
    );
  });

  it('throws on unsupported AST nodes and invalid insert rows', () => {
    expect(() => adapter.lower(new UnsupportedAst(), { contract, params: [] })).toThrow(
      'Unsupported AST node: UnsupportedAst',
    );
    expect(() =>
      adapter.lower(InsertAst.into(TableSource.named('user')).withRows([]), {
        contract,
        params: [],
      }),
    ).toThrow('INSERT requires at least one row');
  });
});
