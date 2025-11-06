import { describe, expect, it } from 'vitest';

import { createPostgresAdapter } from '../src/adapter';
import { validateContract } from '@prisma-next/sql-query/schema';
import type { PostgresContract } from '../src/types';
import type { SelectAst } from '@prisma-next/sql-query/types';

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
              project: [
                { alias: 'id', expr: { kind: 'col', table: 'post', column: 'id' } },
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
              project: [
                { alias: 'id', expr: { kind: 'col', table: 'post', column: 'id' } },
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

      expect(result.body.sql).toContain('LIMIT');
      expect(result.body.sql).toContain('10');
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
              project: [
                { alias: 'id', expr: { kind: 'col', table: 'post', column: 'id' } },
              ],
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
              project: [
                { alias: 'id', expr: { kind: 'col', table: 'post', column: 'id' } },
              ],
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
});
