import { validateContract } from '@prisma-next/sql-query/schema';
import type { DeleteAst, InsertAst, SelectAst, UpdateAst } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';

import { createPostgresAdapter } from '../src/adapter';
import type { PostgresContract } from '../src/types';

const contract = Object.freeze(
  validateContract<PostgresContract>({
    target: 'postgres',
    targetFamily: 'sql' as const,
    coreHash: 'sha256:test-core',
    profileHash: 'sha256:test-profile',
    storage: {
      tables: {
        user: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
            email: { type: 'pg/text@1', nullable: false },
            createdAt: { type: 'pg/timestamptz@1', nullable: false },
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
  }),
);

describe('createPostgresAdapter', () => {
  it('lowers select AST into canonical SQL with positional params', () => {
    const adapter = createPostgresAdapter();

    const ast = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [
        { alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } },
        { alias: 'email', expr: { kind: 'col', table: 'user', column: 'email' } },
      ],
      where: {
        kind: 'bin',
        op: 'eq',
        left: { kind: 'col', table: 'user', column: 'id' },
        right: { kind: 'param', index: 1, name: 'userId' },
      },
      orderBy: [
        {
          expr: { kind: 'col', table: 'user', column: 'createdAt' },
          dir: 'desc',
        },
      ],
      limit: 5,
    } as const;

    const lowered = adapter.lower(ast, { contract, params: [42] });

    expect(lowered.body).toEqual({
      sql: 'SELECT "user"."id" AS "id", "user"."email" AS "email" FROM "user" WHERE "user"."id" = $1 ORDER BY "user"."createdAt" DESC LIMIT 5',
      params: [42],
    });
  });

  describe('includeMany with LATERAL + json_agg', () => {
    it('renders LATERAL + json_agg correctly', () => {
      const adapter = createPostgresAdapter();

      const ast: SelectAst = {
        kind: 'select',
        from: { kind: 'table', name: 'user' },
        includes: [
          {
            kind: 'includeMany',
            alias: 'posts',
            child: {
              table: { kind: 'table', name: 'post' },
              on: {
                kind: 'eqCol',
                left: { kind: 'col', table: 'user', column: 'id' },
                right: { kind: 'col', table: 'post', column: 'userId' },
              },
              project: [
                { alias: 'id', expr: { kind: 'col', table: 'post', column: 'id' } },
                { alias: 'title', expr: { kind: 'col', table: 'post', column: 'title' } },
              ],
            },
          },
        ],
        project: [
          { alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } },
          { alias: 'posts', expr: { kind: 'includeRef', alias: 'posts' } },
        ],
      };

      const result = adapter.lower(ast, { contract, params: [] });

      expect(result.body.sql).toContain('LEFT JOIN LATERAL');
      expect(result.body.sql).toContain('json_agg');
      expect(result.body.sql).toContain('json_build_object');
      expect(result.body.sql).toContain('AS "posts"');
      expect(result.body.sql).toContain('ON true');
    });

    it('includes ORDER BY in lateral subquery', () => {
      const adapter = createPostgresAdapter();

      const ast: SelectAst = {
        kind: 'select',
        from: { kind: 'table', name: 'user' },
        includes: [
          {
            kind: 'includeMany',
            alias: 'posts',
            child: {
              table: { kind: 'table', name: 'post' },
              on: {
                kind: 'eqCol',
                left: { kind: 'col', table: 'user', column: 'id' },
                right: { kind: 'col', table: 'post', column: 'userId' },
              },
              orderBy: [
                {
                  expr: { kind: 'col', table: 'post', column: 'createdAt' },
                  dir: 'desc',
                },
              ],
              project: [{ alias: 'id', expr: { kind: 'col', table: 'post', column: 'id' } }],
            },
          },
        ],
        project: [
          { alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } },
          { alias: 'posts', expr: { kind: 'includeRef', alias: 'posts' } },
        ],
      };

      const result = adapter.lower(ast, { contract, params: [] });

      expect(result.body.sql).toContain('ORDER BY');
      expect(result.body.sql).toContain('"post"."createdAt"');
      expect(result.body.sql).toContain('DESC');
    });

    it('includes LIMIT in lateral subquery', () => {
      const adapter = createPostgresAdapter();

      const ast: SelectAst = {
        kind: 'select',
        from: { kind: 'table', name: 'user' },
        includes: [
          {
            kind: 'includeMany',
            alias: 'posts',
            child: {
              table: { kind: 'table', name: 'post' },
              on: {
                kind: 'eqCol',
                left: { kind: 'col', table: 'user', column: 'id' },
                right: { kind: 'col', table: 'post', column: 'userId' },
              },
              limit: 10,
              project: [{ alias: 'id', expr: { kind: 'col', table: 'post', column: 'id' } }],
            },
          },
        ],
        project: [
          { alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } },
          { alias: 'posts', expr: { kind: 'includeRef', alias: 'posts' } },
        ],
      };

      const result = adapter.lower(ast, { contract, params: [] });

      expect(result.body.sql).toContain('LIMIT');
      expect(result.body.sql).toContain('10');
    });

    it('uses column aliases in ORDER BY when LIMIT is present and column is in SELECT list', () => {
      const adapter = createPostgresAdapter();

      const ast: SelectAst = {
        kind: 'select',
        from: { kind: 'table', name: 'user' },
        includes: [
          {
            kind: 'includeMany',
            alias: 'posts',
            child: {
              table: { kind: 'table', name: 'post' },
              on: {
                kind: 'eqCol',
                left: { kind: 'col', table: 'user', column: 'id' },
                right: { kind: 'col', table: 'post', column: 'userId' },
              },
              limit: 10,
              orderBy: [
                {
                  expr: { kind: 'col', table: 'post', column: 'id' },
                  dir: 'desc',
                },
              ],
              project: [{ alias: 'id', expr: { kind: 'col', table: 'post', column: 'id' } }],
            },
          },
        ],
        project: [
          { alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } },
          { alias: 'posts', expr: { kind: 'includeRef', alias: 'posts' } },
        ],
      };

      const result = adapter.lower(ast, { contract, params: [] });

      // When ORDER BY column is in SELECT list, it should use the column alias
      expect(result.body.sql).toContain('ORDER BY "id" DESC');
      expect(result.body.sql).toContain('LIMIT 10');
    });

    it('uses full column reference in ORDER BY when LIMIT is present and column is not in SELECT list', () => {
      const adapter = createPostgresAdapter();

      const ast: SelectAst = {
        kind: 'select',
        from: { kind: 'table', name: 'user' },
        includes: [
          {
            kind: 'includeMany',
            alias: 'posts',
            child: {
              table: { kind: 'table', name: 'post' },
              on: {
                kind: 'eqCol',
                left: { kind: 'col', table: 'user', column: 'id' },
                right: { kind: 'col', table: 'post', column: 'userId' },
              },
              limit: 10,
              orderBy: [
                {
                  expr: { kind: 'col', table: 'post', column: 'createdAt' },
                  dir: 'desc',
                },
              ],
              project: [{ alias: 'id', expr: { kind: 'col', table: 'post', column: 'id' } }],
            },
          },
        ],
        project: [
          { alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } },
          { alias: 'posts', expr: { kind: 'includeRef', alias: 'posts' } },
        ],
      };

      const result = adapter.lower(ast, { contract, params: [] });

      // When ORDER BY column is NOT in SELECT list, it should use full column reference
      expect(result.body.sql).toContain('ORDER BY "post"."createdAt" DESC');
      expect(result.body.sql).toContain('LIMIT 10');
    });

    it('includes WHERE in lateral subquery', () => {
      const adapter = createPostgresAdapter();

      const ast: SelectAst = {
        kind: 'select',
        from: { kind: 'table', name: 'user' },
        includes: [
          {
            kind: 'includeMany',
            alias: 'posts',
            child: {
              table: { kind: 'table', name: 'post' },
              on: {
                kind: 'eqCol',
                left: { kind: 'col', table: 'user', column: 'id' },
                right: { kind: 'col', table: 'post', column: 'userId' },
              },
              where: {
                kind: 'bin',
                op: 'eq',
                left: { kind: 'col', table: 'post', column: 'published' },
                right: { kind: 'param', index: 1, name: 'published' },
              },
              project: [{ alias: 'id', expr: { kind: 'col', table: 'post', column: 'id' } }],
            },
          },
        ],
        project: [
          { alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } },
          { alias: 'posts', expr: { kind: 'includeRef', alias: 'posts' } },
        ],
      };

      const result = adapter.lower(ast, { contract, params: [true] });

      expect(result.body.sql).toContain('WHERE');
      expect(result.body.sql).toContain('"post"."published"');
      expect(result.body.sql).toContain('$1');
    });

    it('parent projection selects include alias', () => {
      const adapter = createPostgresAdapter();

      const ast: SelectAst = {
        kind: 'select',
        from: { kind: 'table', name: 'user' },
        includes: [
          {
            kind: 'includeMany',
            alias: 'posts',
            child: {
              table: { kind: 'table', name: 'post' },
              on: {
                kind: 'eqCol',
                left: { kind: 'col', table: 'user', column: 'id' },
                right: { kind: 'col', table: 'post', column: 'userId' },
              },
              project: [{ alias: 'id', expr: { kind: 'col', table: 'post', column: 'id' } }],
            },
          },
        ],
        project: [
          { alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } },
          { alias: 'email', expr: { kind: 'col', table: 'user', column: 'email' } },
          { alias: 'posts', expr: { kind: 'includeRef', alias: 'posts' } },
        ],
      };

      const result = adapter.lower(ast, { contract, params: [] });

      expect(result.body.sql).toContain('"posts"');
      expect(result.body.sql).toContain('AS "posts"');
    });
  });

  describe('DML lowering', () => {
    describe('insert', () => {
      it('lowers insert AST into canonical SQL', () => {
        const adapter = createPostgresAdapter();

        const ast: InsertAst = {
          kind: 'insert',
          table: { kind: 'table', name: 'user' },
          values: {
            email: { kind: 'param', index: 1, name: 'email' },
            createdAt: { kind: 'param', index: 2, name: 'createdAt' },
          },
        };

        const lowered = adapter.lower(ast, {
          contract,
          params: ['test@example.com', new Date('2024-01-01')],
        });

        expect(lowered.body).toEqual({
          sql: 'INSERT INTO "user" ("email", "createdAt") VALUES ($1, $2)',
          params: ['test@example.com', new Date('2024-01-01')],
        });
      });

      it('lowers insert AST with returning clause', () => {
        const adapter = createPostgresAdapter();

        const ast: InsertAst = {
          kind: 'insert',
          table: { kind: 'table', name: 'user' },
          values: {
            email: { kind: 'param', index: 1, name: 'email' },
            createdAt: { kind: 'param', index: 2, name: 'createdAt' },
          },
          returning: [
            { kind: 'col', table: 'user', column: 'id' },
            { kind: 'col', table: 'user', column: 'email' },
          ],
        };

        const lowered = adapter.lower(ast, {
          contract,
          params: ['test@example.com', new Date('2024-01-01')],
        });

        expect(lowered.body).toEqual({
          sql: 'INSERT INTO "user" ("email", "createdAt") VALUES ($1, $2) RETURNING "user"."id", "user"."email"',
          params: ['test@example.com', new Date('2024-01-01')],
        });
      });
    });

    describe('update', () => {
      it('lowers update AST into canonical SQL', () => {
        const adapter = createPostgresAdapter();

        const ast: UpdateAst = {
          kind: 'update',
          table: { kind: 'table', name: 'user' },
          set: {
            email: { kind: 'param', index: 1, name: 'newEmail' },
          },
          where: {
            kind: 'bin',
            op: 'eq',
            left: { kind: 'col', table: 'user', column: 'id' },
            right: { kind: 'param', index: 2, name: 'userId' },
          },
        };

        const lowered = adapter.lower(ast, { contract, params: ['updated@example.com', 1] });

        expect(lowered.body).toEqual({
          sql: 'UPDATE "user" SET "email" = $1 WHERE "user"."id" = $2',
          params: ['updated@example.com', 1],
        });
      });

      it('lowers update AST with returning clause', () => {
        const adapter = createPostgresAdapter();

        const ast: UpdateAst = {
          kind: 'update',
          table: { kind: 'table', name: 'user' },
          set: {
            email: { kind: 'param', index: 1, name: 'newEmail' },
          },
          where: {
            kind: 'bin',
            op: 'eq',
            left: { kind: 'col', table: 'user', column: 'id' },
            right: { kind: 'param', index: 2, name: 'userId' },
          },
          returning: [
            { kind: 'col', table: 'user', column: 'id' },
            { kind: 'col', table: 'user', column: 'email' },
          ],
        };

        const lowered = adapter.lower(ast, { contract, params: ['updated@example.com', 1] });

        expect(lowered.body).toEqual({
          sql: 'UPDATE "user" SET "email" = $1 WHERE "user"."id" = $2 RETURNING "user"."id", "user"."email"',
          params: ['updated@example.com', 1],
        });
      });
    });

    describe('delete', () => {
      it('lowers delete AST into canonical SQL', () => {
        const adapter = createPostgresAdapter();

        const ast: DeleteAst = {
          kind: 'delete',
          table: { kind: 'table', name: 'user' },
          where: {
            kind: 'bin',
            op: 'eq',
            left: { kind: 'col', table: 'user', column: 'id' },
            right: { kind: 'param', index: 1, name: 'userId' },
          },
        };

        const lowered = adapter.lower(ast, { contract, params: [1] });

        expect(lowered.body).toEqual({
          sql: 'DELETE FROM "user" WHERE "user"."id" = $1',
          params: [1],
        });
      });

      it('lowers delete AST with returning clause', () => {
        const adapter = createPostgresAdapter();

        const ast: DeleteAst = {
          kind: 'delete',
          table: { kind: 'table', name: 'user' },
          where: {
            kind: 'bin',
            op: 'eq',
            left: { kind: 'col', table: 'user', column: 'id' },
            right: { kind: 'param', index: 1, name: 'userId' },
          },
          returning: [
            { kind: 'col', table: 'user', column: 'id' },
            { kind: 'col', table: 'user', column: 'email' },
          ],
        };

        const lowered = adapter.lower(ast, { contract, params: [1] });

        expect(lowered.body).toEqual({
          sql: 'DELETE FROM "user" WHERE "user"."id" = $1 RETURNING "user"."id", "user"."email"',
          params: [1],
        });
      });
    });
  });
});
