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
  JoinAst,
  JsonArrayAggExpr,
  JsonObjectExpr,
  ListExpression,
  LiteralExpr,
  NullCheckExpr,
  OrderByItem,
  OrExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createSqliteAdapter } from '../src/core/adapter';
import type { SqliteContract } from '../src/core/types';

const contract = validateContract<SqliteContract>({
  target: 'sqlite',
  targetFamily: 'sql',
  storageHash: 'sha256:test-core',
  profileHash: 'sha256:test-profile',
  storage: {
    tables: {
      user: {
        columns: {
          id: { codecId: 'sqlite/integer@1', nativeType: 'integer', nullable: false },
          email: { codecId: 'sqlite/text@1', nativeType: 'text', nullable: false },
          active: { codecId: 'sqlite/boolean@1', nativeType: 'integer', nullable: false },
          metadata: { codecId: 'sqlite/json@1', nativeType: 'text', nullable: true },
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
      post: {
        columns: {
          id: { codecId: 'sqlite/integer@1', nativeType: 'integer', nullable: false },
          userId: { codecId: 'sqlite/integer@1', nativeType: 'integer', nullable: false },
          title: { codecId: 'sqlite/text@1', nativeType: 'text', nullable: false },
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

describe('SQLite adapter', () => {
  const adapter = createSqliteAdapter();

  describe('SELECT', () => {
    it('renders simple select', () => {
      const ast = SelectAst.from(TableSource.named('user')).withProjection([
        ProjectionItem.of('id', ColumnRef.of('user', 'id')),
        ProjectionItem.of('email', ColumnRef.of('user', 'email')),
      ]);

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toBe('SELECT "user"."id" AS "id", "user"."email" AS "email" FROM "user"');
    });

    it('renders select with WHERE and ? params', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'email'), ParamRef.of('test@example.com')));

      const lowered = adapter.lower(ast, { contract });
      expect(lowered.body.sql).toBe(
        'SELECT "user"."id" AS "id" FROM "user" WHERE "user"."email" = ?',
      );
      expect(lowered.body.params).toEqual(['test@example.com']);
    });

    it('renders ORDER BY, LIMIT, OFFSET', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withOrderBy([new OrderByItem(ColumnRef.of('user', 'id'), 'asc')])
        .withLimit(10)
        .withOffset(5);

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toBe(
        'SELECT "user"."id" AS "id" FROM "user" ORDER BY "user"."id" ASC LIMIT 10 OFFSET 5',
      );
    });

    it('renders DISTINCT', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('email', ColumnRef.of('user', 'email'))])
        .withDistinct();

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toContain('SELECT DISTINCT');
    });

    it('renders GROUP BY and HAVING', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([
          ProjectionItem.of('email', ColumnRef.of('user', 'email')),
          ProjectionItem.of('cnt', AggregateExpr.count()),
        ])
        .withGroupBy([ColumnRef.of('user', 'email')])
        .withHaving(BinaryExpr.gt(AggregateExpr.count(), LiteralExpr.of(1)));

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toContain('GROUP BY "user"."email"');
      expect(sql).toContain('HAVING COUNT(*) > 1');
    });

    it('renders table alias', () => {
      const ast = SelectAst.from(TableSource.named('user', 'u')).withProjection([
        ProjectionItem.of('id', ColumnRef.of('u', 'id')),
      ]);

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toContain('FROM "user" AS "u"');
    });

    it('renders subquery in projection', () => {
      const subquery = SelectAst.from(TableSource.named('post'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('post', 'id'))])
        .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'userId'), ColumnRef.of('user', 'id')));

      const ast = SelectAst.from(TableSource.named('user')).withProjection([
        ProjectionItem.of('id', ColumnRef.of('user', 'id')),
        ProjectionItem.of('firstPostId', SubqueryExpr.of(subquery)),
      ]);

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toContain(
        '(SELECT "post"."id" AS "id" FROM "post" WHERE "post"."userId" = "user"."id") AS "firstPostId"',
      );
    });

    it('renders EXISTS and NOT EXISTS', () => {
      const subquery = SelectAst.from(TableSource.named('post'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('post', 'id'))])
        .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'userId'), ColumnRef.of('user', 'id')));

      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withWhere(ExistsExpr.notExists(subquery));

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toContain('NOT EXISTS (SELECT');
    });

    it('renders null checks', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withWhere(
          AndExpr.of([
            NullCheckExpr.isNull(ColumnRef.of('user', 'metadata')),
            NullCheckExpr.isNotNull(ColumnRef.of('user', 'email')),
          ]),
        );

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toContain('"user"."metadata" IS NULL');
      expect(sql).toContain('"user"."email" IS NOT NULL');
    });

    it('renders empty IN as FALSE, empty NOT IN as TRUE', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withWhere(
          AndExpr.of([
            BinaryExpr.in(ColumnRef.of('user', 'id'), ListExpression.fromValues([])),
            BinaryExpr.notIn(ColumnRef.of('user', 'id'), ListExpression.fromValues([])),
          ]),
        );

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toContain('FALSE');
      expect(sql).toContain('TRUE');
    });

    it('renders empty OR as FALSE', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withWhere(OrExpr.false());

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toContain('WHERE FALSE');
    });
  });

  describe('INSERT', () => {
    it('renders insert with ? params', () => {
      const ast = InsertAst.into(TableSource.named('user')).withRows([
        {
          id: ParamRef.of(1, { name: 'id' }),
          email: ParamRef.of('a@example.com', { name: 'email' }),
        },
      ]);

      const lowered = adapter.lower(ast, { contract });
      expect(lowered.body.sql).toBe('INSERT INTO "user" ("id", "email") VALUES (?, ?)');
      expect(lowered.body.params).toEqual([1, 'a@example.com']);
    });

    it('renders multi-row insert', () => {
      const ast = InsertAst.into(TableSource.named('user')).withRows([
        { id: ParamRef.of(1), email: ParamRef.of('a@example.com') },
        { id: ParamRef.of(2), email: ParamRef.of('b@example.com') },
      ]);

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toBe('INSERT INTO "user" ("id", "email") VALUES (?, ?), (?, ?)');
    });

    it('renders DEFAULT VALUES', () => {
      const ast = InsertAst.into(TableSource.named('user')).withRows([{}]);

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toBe('INSERT INTO "user" DEFAULT VALUES');
    });

    it('renders ON CONFLICT DO NOTHING', () => {
      const ast = InsertAst.into(TableSource.named('user'))
        .withRows([{ id: ParamRef.of(1), email: ParamRef.of('a@example.com') }])
        .withOnConflict(InsertOnConflict.on([ColumnRef.of('user', 'email')]).doNothing());

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toContain('ON CONFLICT ("email") DO NOTHING');
    });

    it('renders ON CONFLICT DO UPDATE SET', () => {
      const ast = InsertAst.into(TableSource.named('user'))
        .withRows([{ id: ParamRef.of(1), email: ParamRef.of('a@example.com') }])
        .withOnConflict(
          InsertOnConflict.on([ColumnRef.of('user', 'email')]).doUpdateSet({
            email: ColumnRef.of('excluded', 'email'),
          }),
        );

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toContain('ON CONFLICT ("email") DO UPDATE SET "email" = excluded."email"');
    });

    it('renders RETURNING', () => {
      const ast = InsertAst.into(TableSource.named('user'))
        .withRows([{ id: ParamRef.of(1), email: ParamRef.of('a@example.com') }])
        .withReturning([ColumnRef.of('user', 'id')]);

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toContain('RETURNING "user"."id"');
    });

    it('throws on DEFAULT value in VALUES (unsupported by SQLite)', () => {
      const ast = InsertAst.into(TableSource.named('user')).withRows([
        { id: ParamRef.of(1), email: new DefaultValueExpr() },
      ]);

      expect(() => adapter.lower(ast, { contract })).toThrow(
        'SQLite does not support DEFAULT as a value in INSERT ... VALUES',
      );
    });
  });

  describe('UPDATE', () => {
    it('renders update with WHERE and ? params', () => {
      const ast = UpdateAst.table(TableSource.named('user'))
        .withSet({ email: ParamRef.of('b@example.com') })
        .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'id'), ParamRef.of(1)));

      const lowered = adapter.lower(ast, { contract });
      expect(lowered.body.sql).toBe('UPDATE "user" SET "email" = ? WHERE "user"."id" = ?');
      expect(lowered.body.params).toEqual(['b@example.com', 1]);
    });

    it('renders update with RETURNING', () => {
      const ast = UpdateAst.table(TableSource.named('user'))
        .withSet({ email: ParamRef.of('b@example.com') })
        .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'id'), ParamRef.of(1)))
        .withReturning([ColumnRef.of('user', 'email')]);

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toBe(
        'UPDATE "user" SET "email" = ? WHERE "user"."id" = ? RETURNING "user"."email"',
      );
    });
  });

  describe('DELETE', () => {
    it('renders delete with WHERE', () => {
      const ast = DeleteAst.from(TableSource.named('user')).withWhere(
        BinaryExpr.eq(ColumnRef.of('user', 'id'), ParamRef.of(1)),
      );

      const lowered = adapter.lower(ast, { contract });
      expect(lowered.body.sql).toBe('DELETE FROM "user" WHERE "user"."id" = ?');
      expect(lowered.body.params).toEqual([1]);
    });

    it('renders delete with RETURNING', () => {
      const ast = DeleteAst.from(TableSource.named('user'))
        .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'id'), ParamRef.of(1)))
        .withReturning([ColumnRef.of('user', 'id')]);

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toBe('DELETE FROM "user" WHERE "user"."id" = ? RETURNING "user"."id"');
    });
  });

  describe('JSON functions', () => {
    it('renders json_object instead of json_build_object', () => {
      const ast = SelectAst.from(TableSource.named('user')).withProjection([
        ProjectionItem.of(
          'payload',
          JsonObjectExpr.fromEntries([
            JsonObjectExpr.entry('email', ColumnRef.of('user', 'email')),
            JsonObjectExpr.entry('count', AggregateExpr.count()),
          ]),
        ),
      ]);

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toContain('json_object(\'email\', "user"."email", \'count\', COUNT(*))');
    });

    it('renders json_group_array instead of json_agg', () => {
      const ast = SelectAst.from(TableSource.named('post')).withProjection([
        ProjectionItem.of('posts', JsonArrayAggExpr.of(ColumnRef.of('post', 'title'))),
      ]);

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toContain('json_group_array("post"."title")');
    });

    it('renders coalesce with empty array literal for onEmpty', () => {
      const ast = SelectAst.from(TableSource.named('post')).withProjection([
        ProjectionItem.of(
          'posts',
          JsonArrayAggExpr.of(ColumnRef.of('post', 'title'), 'emptyArray'),
        ),
      ]);

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toContain('coalesce(json_group_array("post"."title"), \'[]\')');
    });
  });

  describe('literals', () => {
    it('renders string, number, boolean, null, date, and object literals', () => {
      const ast = SelectAst.from(TableSource.named('user')).withProjection([
        ProjectionItem.of('bigintValue', LiteralExpr.of(12n)),
        ProjectionItem.of('dateValue', LiteralExpr.of(new Date('2024-01-01T00:00:00.000Z'))),
        ProjectionItem.of('jsonValue', LiteralExpr.of({ ok: true })),
        ProjectionItem.of('missingValue', LiteralExpr.of(undefined)),
      ]);

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toBe(
        `SELECT 12 AS "bigintValue", '2024-01-01T00:00:00.000Z' AS "dateValue", '{"ok":true}' AS "jsonValue", NULL AS "missingValue" FROM "user"`,
      );
    });
  });

  describe('negative cases', () => {
    it('does not emit DISTINCT ON (Postgres-only)', () => {
      const ast = SelectAst.from(TableSource.named('user')).withProjection([
        ProjectionItem.of('id', ColumnRef.of('user', 'id')),
      ]);

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).not.toContain('DISTINCT ON');
    });

    it('does not emit LATERAL in joins', () => {
      const ast = SelectAst.from(TableSource.named('user')).withProjection([
        ProjectionItem.of('id', ColumnRef.of('user', 'id')),
      ]);

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).not.toContain('LATERAL');
    });

    it('does not emit ::type cast syntax', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withWhere(
          BinaryExpr.eq(
            ColumnRef.of('user', 'metadata'),
            ParamRef.of({ active: true }, { name: 'metadata', codecId: 'sqlite/json@1' }),
          ),
        );

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).not.toContain('::');
      expect(sql).toContain('= ?');
    });

    it('maps ILIKE to LIKE', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withWhere(BinaryExpr.ilike(ColumnRef.of('user', 'email'), ParamRef.of('%test%')));

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toContain('LIKE ?');
      expect(sql).not.toContain('ILIKE');
    });

    it('throws on unsupported AST node kind', () => {
      const unsupported = {
        kind: 'unsupported',
        collectParamRefs: () => [],
        collectRefs: () => ({ tables: [], columns: [] }),
      } as unknown as AnyQueryAst;
      expect(() => adapter.lower(unsupported, { contract })).toThrow(
        'Unsupported AST node kind: unsupported',
      );
    });

    it('throws on empty insert rows', () => {
      expect(() =>
        adapter.lower(InsertAst.into(TableSource.named('user')).withRows([]), { contract }),
      ).toThrow('INSERT requires at least one row');
    });
  });

  describe('joins', () => {
    it('renders INNER JOIN', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([
          ProjectionItem.of('id', ColumnRef.of('user', 'id')),
          ProjectionItem.of('title', ColumnRef.of('post', 'title')),
        ])
        .withJoins([
          new JoinAst(
            'inner',
            TableSource.named('post'),
            BinaryExpr.eq(ColumnRef.of('post', 'userId'), ColumnRef.of('user', 'id')),
          ),
        ]);

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toContain('INNER JOIN "post" ON "post"."userId" = "user"."id"');
    });

    it('renders LEFT JOIN', () => {
      const ast = SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withJoins([
          new JoinAst(
            'left',
            TableSource.named('post'),
            BinaryExpr.eq(ColumnRef.of('post', 'userId'), ColumnRef.of('user', 'id')),
          ),
        ]);

      const { sql } = adapter.lower(ast, { contract }).body;
      expect(sql).toContain('LEFT JOIN "post" ON');
    });
  });
});
