import { validateContract } from '@prisma-next/sql-contract/validate';
import {
  AggregateExpr,
  AndExpr,
  type AnyQueryAst,
  BinaryExpr,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  ExistsExpr,
  InsertAst,
  InsertOnConflict,
  JsonObjectExpr,
  ListLiteralExpr,
  LiteralExpr,
  NullCheckExpr,
  OperationExpr,
  OrExpr,
  ParamRef,
  ProjectionItem,
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
          profile: { codecId: 'pg/jsonb@1', nativeType: 'jsonb', nullable: true },
          metadata: { codecId: 'pg/json@1', nativeType: 'json', nullable: true },
          vector: { codecId: 'pg/vector@1', nativeType: 'vector', nullable: false },
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

describe('Postgres adapter', () => {
  const adapter = createPostgresAdapter();

  it('lowers rich select statements with aggregates, JSON, and subqueries', () => {
    const subquery = SelectAst.from(TableSource.named('post'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('post', 'id'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'userId'), ColumnRef.of('user', 'id')));
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([
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
        {
          id: ParamRef.of(1, { name: 'id', codecId: 'pg/int4@1' }),
          email: ParamRef.of('a@example.com', { name: 'email', codecId: 'pg/text@1' }),
        },
        {
          id: ParamRef.of(2, { name: 'id2', codecId: 'pg/int4@1' }),
          email: new DefaultValueExpr(),
        },
      ])
      .withOnConflict(
        InsertOnConflict.on([ColumnRef.of('user', 'email')]).doUpdateSet({
          email: ColumnRef.of('excluded', 'email'),
        }),
      )
      .withReturning([ColumnRef.of('user', 'id')]);
    const updateAst = UpdateAst.table(TableSource.named('user'))
      .withSet({ email: ParamRef.of('b@example.com', { name: 'email', codecId: 'pg/text@1' }) })
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'id'),
          ParamRef.of(1, { name: 'id', codecId: 'pg/int4@1' }),
        ),
      )
      .withReturning([ColumnRef.of('user', 'email')]);
    const deleteAst = DeleteAst.from(TableSource.named('user'))
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'id'),
          ParamRef.of(1, { name: 'id', codecId: 'pg/int4@1' }),
        ),
      )
      .withReturning([ColumnRef.of('user', 'id')]);

    expect(adapter.lower(insertAst, { contract }).body.sql).toContain(
      'ON CONFLICT ("email") DO UPDATE SET "email" = excluded."email"',
    );
    expect(adapter.lower(updateAst, { contract }).body.sql).toBe(
      'UPDATE "user" SET "email" = $1 WHERE "user"."id" = $2 RETURNING "user"."email"',
    );
    expect(adapter.lower(deleteAst, { contract }).body.sql).toBe(
      'DELETE FROM "user" WHERE "user"."id" = $1 RETURNING "user"."id"',
    );
  });

  it('throws on unsupported AST nodes and invalid insert rows', () => {
    const unsupported = {
      kind: 'unsupported',
      collectParamRefs: () => [],
      collectRefs: () => ({ tables: [], columns: [] }),
    } as unknown as AnyQueryAst;
    expect(() => adapter.lower(unsupported, { contract, params: [] })).toThrow(
      'Unsupported AST node kind: unsupported',
    );
    expect(() =>
      adapter.lower(InsertAst.into(TableSource.named('user')).withRows([]), {
        contract,
        params: [],
      }),
    ).toThrow('INSERT requires at least one row');
  });

  it('lowers distinct, exists, null checks, and typed JSON parameters in WHERE clauses', () => {
    const existsSubquery = SelectAst.from(TableSource.named('post'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('post', 'id'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'userId'), ColumnRef.of('user', 'id')));
    const vectorLength = OperationExpr.function({
      method: 'vectorLength',
      forTypeId: 'pg/vector@1',
      self: ColumnRef.of('user', 'vector'),
      args: [],
      returns: { kind: 'builtin', type: 'number' },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template
      template: 'vector_length(${self})',
    });
    const scalarSubquery = SelectAst.from(TableSource.named('post'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('post', 'id'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'userId'), ColumnRef.of('user', 'id')));
    const ast = SelectAst.from(TableSource.named('user'))
      .withDistinctOn([ColumnRef.of('user', 'email')])
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        AndExpr.of([
          ExistsExpr.notExists(existsSubquery),
          NullCheckExpr.isNull(vectorLength),
          NullCheckExpr.isNotNull(SubqueryExpr.of(scalarSubquery)),
          BinaryExpr.eq(
            ColumnRef.of('user', 'profile'),
            ParamRef.of({ active: true }, { name: 'profile', codecId: 'pg/jsonb@1' }),
          ),
          BinaryExpr.eq(
            ColumnRef.of('user', 'metadata'),
            ParamRef.of({ source: 'test' }, { name: 'metadata', codecId: 'pg/json@1' }),
          ),
          BinaryExpr.in(ColumnRef.of('user', 'id'), ListLiteralExpr.fromValues([])),
          BinaryExpr.notIn(ColumnRef.of('user', 'id'), ListLiteralExpr.fromValues([])),
        ]),
      );

    const lowered = adapter.lower(ast, { contract });

    expect(lowered.body.sql).toBe(
      [
        'SELECT DISTINCT ON ("user"."email") "user"."id" AS "id"',
        'FROM "user"',
        'WHERE (NOT EXISTS (SELECT "post"."id" AS "id" FROM "post" WHERE "post"."userId" = "user"."id")',
        'AND (vector_length("user"."vector")) IS NULL',
        'AND ((SELECT "post"."id" AS "id" FROM "post" WHERE "post"."userId" = "user"."id")) IS NOT NULL',
        'AND "user"."profile" = $1::jsonb',
        'AND "user"."metadata" = $2::json',
        'AND FALSE',
        'AND TRUE)',
      ].join(' '),
    );
  });

  it('lowers default-value inserts with DO NOTHING conflict handling', () => {
    const ast = InsertAst.into(TableSource.named('user'))
      .withRows([{}])
      .withOnConflict(InsertOnConflict.on([ColumnRef.of('user', 'email')]).doNothing());

    expect(adapter.lower(ast, { contract, params: [] }).body.sql).toBe(
      'INSERT INTO "user" DEFAULT VALUES ON CONFLICT ("email") DO NOTHING',
    );
  });

  it('renders bigint, date, array, object, and undefined literals in projections', () => {
    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('bigintValue', LiteralExpr.of(12n)),
      ProjectionItem.of('createdAtLiteral', LiteralExpr.of(new Date('2024-01-01T00:00:00.000Z'))),
      ProjectionItem.of('arrayValue', LiteralExpr.of([1, 'two'])),
      ProjectionItem.of('jsonValue', LiteralExpr.of({ ok: true })),
      ProjectionItem.of('missingValue', LiteralExpr.of(undefined)),
    ]);

    const sql = adapter.lower(ast, { contract, params: [] }).body.sql;

    expect(sql).toBe(
      `SELECT 12 AS "bigintValue", '2024-01-01T00:00:00.000Z' AS "createdAtLiteral", ARRAY[1, 'two'] AS "arrayValue", '{"ok":true}' AS "jsonValue", NULL AS "missingValue" FROM "user"`,
    );
  });

  it('renders DISTINCT, GROUP BY, HAVING, and OR clauses', () => {
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([
        ProjectionItem.of('email', ColumnRef.of('user', 'email')),
        ProjectionItem.of('cnt', AggregateExpr.count()),
      ])
      .withDistinct()
      .withGroupBy([ColumnRef.of('user', 'email')])
      .withHaving(BinaryExpr.gt(AggregateExpr.count(), LiteralExpr.of(1)))
      .withWhere(OrExpr.of([BinaryExpr.eq(ColumnRef.of('user', 'id'), LiteralExpr.of(1))]));

    const sql = adapter.lower(ast, { contract, params: [] }).body.sql;

    expect(sql).toContain('SELECT DISTINCT');
    expect(sql).toContain('GROUP BY "user"."email"');
    expect(sql).toContain('HAVING COUNT(*) > 1');
    expect(sql).toContain('WHERE ("user"."id" = 1)');
  });

  it('renders TableSource with alias', () => {
    const ast = SelectAst.from(TableSource.named('user', 'u')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('u', 'id')),
    ]);

    const sql = adapter.lower(ast, { contract, params: [] }).body.sql;

    expect(sql).toContain('FROM "user" AS "u"');
  });

  it('renders empty OR as FALSE', () => {
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(OrExpr.false());

    const sql = adapter.lower(ast, { contract, params: [] }).body.sql;

    expect(sql).toContain('WHERE FALSE');
  });
});
