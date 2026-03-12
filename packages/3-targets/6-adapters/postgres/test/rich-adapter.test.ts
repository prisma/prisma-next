import { validateContract } from '@prisma-next/sql-contract/validate';
import {
  AggregateExpr,
  AndExpr,
  BinaryExpr,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  DerivedTableSource,
  InsertAst,
  InsertOnConflict,
  JoinAst,
  JsonArrayAggExpr,
  JsonObjectExpr,
  OperationExpr,
  OrderByItem,
  ParamRef,
  ProjectionItem,
  SelectAst,
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
          vector: { codecId: 'pg/vector@1', nativeType: 'vector', nullable: false },
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
      post: {
        columns: {
          id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
          user_id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
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

describe('Postgres rich AST lowering', () => {
  const adapter = createPostgresAdapter();

  it('lowers selects with derived lateral joins and rich JSON expressions', () => {
    const childRows = SelectAst.from(TableSource.named('post'))
      .withProject([
        ProjectionItem.of('id', ColumnRef.of('post', 'id')),
        ProjectionItem.of('title', ColumnRef.of('post', 'title')),
      ])
      .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'user_id'), ColumnRef.of('user', 'id')))
      .withOrderBy([OrderByItem.asc(ColumnRef.of('post', 'title'))])
      .withLimit(2);

    const aggregateQuery = SelectAst.from(
      DerivedTableSource.as('post_rows', childRows),
    ).withProject([
      ProjectionItem.of(
        'posts',
        JsonArrayAggExpr.of(
          JsonObjectExpr.fromEntries([
            JsonObjectExpr.entry('id', ColumnRef.of('post_rows', 'id')),
            JsonObjectExpr.entry('title', ColumnRef.of('post_rows', 'title')),
          ]),
          'emptyArray',
          [OrderByItem.asc(ColumnRef.of('post_rows', 'title'))],
        ),
      ),
    ]);

    const ast = SelectAst.from(TableSource.named('user'))
      .withProject([
        ProjectionItem.of('id', ColumnRef.of('user', 'id')),
        ProjectionItem.of('posts', ColumnRef.of('posts_lateral', 'posts')),
      ])
      .withJoins([
        JoinAst.left(DerivedTableSource.as('posts_lateral', aggregateQuery), AndExpr.true(), true),
      ])
      .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'id'), ParamRef.of(1, 'userId')))
      .withOrderBy([OrderByItem.desc(ColumnRef.of('user', 'createdAt'))])
      .withLimit(10)
      .withOffset(5);

    const lowered = adapter.lower(ast, { contract, params: [1] });

    expect(lowered.body.sql).toContain('LEFT JOIN LATERAL');
    expect(lowered.body.sql).toContain('json_agg(json_build_object');
    expect(lowered.body.sql).toContain('ORDER BY "post_rows"."title" ASC');
    expect(lowered.body.sql).toContain('LIMIT 10 OFFSET 5');
    expect(lowered.body.sql).toContain('WHERE "user"."id" = $1');
  });

  it('lowers typed operations and casts vector parameters', () => {
    const distance = new OperationExpr({
      method: 'cosineDistance',
      forTypeId: 'pg/vector@1',
      self: ColumnRef.of('user', 'vector'),
      args: [ParamRef.of(1, 'other')],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template
        template: '${self} <=> ${arg0}',
      },
    });

    const ast = SelectAst.from(TableSource.named('user')).withProject([
      ProjectionItem.of('distance', distance),
      ProjectionItem.of('count', AggregateExpr.count()),
    ]);

    const lowered = adapter.lower(ast, { contract, params: [[1, 2, 3]] });

    expect(lowered.body.sql).toContain('"user"."vector" <=> $1::vector');
    expect(lowered.body.sql).toContain('COUNT(*) AS "count"');
  });

  it('lowers insert, update, and delete statements built from rich nodes', () => {
    const insertAst = InsertAst.into(TableSource.named('user'))
      .withRows([
        {
          id: ParamRef.of(1, 'id'),
          email: ParamRef.of(2, 'email'),
        },
        {
          id: ParamRef.of(3, 'id'),
          email: new DefaultValueExpr(),
        },
      ])
      .withOnConflict(
        InsertOnConflict.on([ColumnRef.of('user', 'email')]).doUpdateSet({
          email: ColumnRef.of('excluded', 'email'),
        }),
      )
      .withReturning([ColumnRef.of('user', 'id'), ColumnRef.of('user', 'email')]);

    const insertSql = adapter.lower(insertAst, { contract, params: [1, 'a@example.com', 2] }).body
      .sql;
    expect(insertSql).toContain(
      'INSERT INTO "user" ("id", "email") VALUES ($1, $2), ($3, DEFAULT)',
    );
    expect(insertSql).toContain('ON CONFLICT ("email") DO UPDATE SET "email" = excluded."email"');
    expect(insertSql).toContain('RETURNING "user"."id", "user"."email"');

    const updateAst = UpdateAst.table(TableSource.named('user'))
      .withSet({ email: ParamRef.of(1, 'email') })
      .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'id'), ParamRef.of(2, 'id')))
      .withReturning([ColumnRef.of('user', 'id')]);
    const updateSql = adapter.lower(updateAst, { contract, params: ['b@example.com', 1] }).body.sql;
    expect(updateSql).toBe(
      'UPDATE "user" SET "email" = $1 WHERE "user"."id" = $2 RETURNING "user"."id"',
    );

    const deleteAst = DeleteAst.from(TableSource.named('user'))
      .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'id'), ParamRef.of(1, 'id')))
      .withReturning([ColumnRef.of('user', 'id')]);
    const deleteSql = adapter.lower(deleteAst, { contract, params: [1] }).body.sql;
    expect(deleteSql).toBe('DELETE FROM "user" WHERE "user"."id" = $1 RETURNING "user"."id"');
  });
});
