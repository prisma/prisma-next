import { validateContract } from '@prisma-next/sql-contract/validate';
import type {
  DeleteAst,
  InsertAst,
  QueryAst,
  SelectAst,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';

import { createPostgresAdapter } from '../src/core/adapter';
import type { PostgresContract } from '../src/core/types';

const contract = Object.freeze(
  validateContract<PostgresContract>({
    target: 'postgres',
    targetFamily: 'sql' as const,
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
      },
    },
    models: {},
    relations: {},
    mappings: {},
  }),
);

describe('createPostgresAdapter', () => {
  it('exposes registered codecs on profile', () => {
    const adapter = createPostgresAdapter();
    const codecIds = [...adapter.profile.codecs().values()].map((codec) => codec.id);

    expect(codecIds).toContain('pg/json@1');
    expect(codecIds).toContain('pg/jsonb@1');
  });

  it('exposes parameterized codecs', () => {
    const adapter = createPostgresAdapter();
    const codecs = adapter.parameterizedCodecs();

    expect(codecs.some((codec) => codec.codecId === 'pg/numeric@1')).toBe(true);
  });

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

  it('renders gt operator correctly', () => {
    const adapter = createPostgresAdapter();

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
      where: {
        kind: 'bin',
        op: 'gt',
        left: { kind: 'col', table: 'user', column: 'id' },
        right: { kind: 'param', index: 1, name: 'minId' },
      },
    } as const;

    const lowered = adapter.lower(ast, { contract, params: [10] });

    expect(lowered.body.sql).toContain('"user"."id" > $1');
  });

  it('renders lt operator correctly', () => {
    const adapter = createPostgresAdapter();

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
      where: {
        kind: 'bin',
        op: 'lt',
        left: { kind: 'col', table: 'user', column: 'id' },
        right: { kind: 'param', index: 1, name: 'maxId' },
      },
    } as const;

    const lowered = adapter.lower(ast, { contract, params: [100] });

    expect(lowered.body.sql).toContain('"user"."id" < $1');
  });

  it('renders gte operator correctly', () => {
    const adapter = createPostgresAdapter();

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
      where: {
        kind: 'bin',
        op: 'gte',
        left: { kind: 'col', table: 'user', column: 'id' },
        right: { kind: 'param', index: 1, name: 'minId' },
      },
    } as const;

    const lowered = adapter.lower(ast, { contract, params: [10] });

    expect(lowered.body.sql).toContain('"user"."id" >= $1');
  });

  it('renders lte operator correctly', () => {
    const adapter = createPostgresAdapter();

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
      where: {
        kind: 'bin',
        op: 'lte',
        left: { kind: 'col', table: 'user', column: 'id' },
        right: { kind: 'param', index: 1, name: 'maxId' },
      },
    } as const;

    const lowered = adapter.lower(ast, { contract, params: [100] });

    expect(lowered.body.sql).toContain('"user"."id" <= $1');
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

      it('lowers insert AST with column reference in values', () => {
        const adapter = createPostgresAdapter();

        const ast: InsertAst = {
          kind: 'insert',
          table: { kind: 'table', name: 'user' },
          values: {
            email: { kind: 'param', index: 1, name: 'email' },
            copyFrom: { kind: 'col', table: 'user', column: 'otherColumn' },
          },
        };

        const lowered = adapter.lower(ast, {
          contract,
          params: ['test@example.com'],
        });

        expect(lowered.body).toEqual({
          sql: 'INSERT INTO "user" ("email", "copyFrom") VALUES ($1, "user"."otherColumn")',
          params: ['test@example.com'],
        });
      });

      it('throws error for unsupported value kind in INSERT', () => {
        const adapter = createPostgresAdapter();

        const ast = {
          kind: 'insert' as const,
          table: { kind: 'table' as const, name: 'user' },
          values: {
            email: { kind: 'invalid' as 'param', index: 1 },
          },
        } as InsertAst;

        expect(() => {
          adapter.lower(ast, { contract, params: ['test@example.com'] });
        }).toThrow('Unsupported value kind in INSERT');
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

      it('lowers update AST with column reference in set', () => {
        const adapter = createPostgresAdapter();

        const ast: UpdateAst = {
          kind: 'update',
          table: { kind: 'table', name: 'user' },
          set: {
            email: { kind: 'param', index: 1, name: 'newEmail' },
            copyFrom: { kind: 'col', table: 'user', column: 'otherColumn' },
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
          sql: 'UPDATE "user" SET "email" = $1, "copyFrom" = "user"."otherColumn" WHERE "user"."id" = $2',
          params: ['updated@example.com', 1],
        });
      });

      it('throws error for unsupported value kind in UPDATE', () => {
        const adapter = createPostgresAdapter();

        const ast = {
          kind: 'update' as const,
          table: { kind: 'table' as const, name: 'user' },
          set: {
            email: { kind: 'invalid' as 'param', index: 1 },
          },
          where: {
            kind: 'bin' as const,
            op: 'eq' as const,
            left: { kind: 'col' as const, table: 'user', column: 'id' },
            right: { kind: 'param' as const, index: 1 },
          },
        } as UpdateAst;

        expect(() => {
          adapter.lower(ast, { contract, params: ['test@example.com'] });
        }).toThrow('Unsupported value kind in UPDATE');
      });

      it('lowers update AST without where clause', () => {
        const adapter = createPostgresAdapter();

        const ast: UpdateAst = {
          kind: 'update',
          table: { kind: 'table', name: 'user' },
          set: {
            email: { kind: 'param', index: 1, name: 'newEmail' },
          },
        };

        const lowered = adapter.lower(ast, { contract, params: ['updated@example.com'] });

        expect(lowered.body.sql).toBe('UPDATE "user" SET "email" = $1');
        expect(lowered.body.params).toEqual(['updated@example.com']);
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

      it('lowers delete AST without where clause', () => {
        const adapter = createPostgresAdapter();

        const ast: DeleteAst = {
          kind: 'delete',
          table: { kind: 'table', name: 'user' },
        };

        const lowered = adapter.lower(ast, { contract, params: [] });

        expect(lowered.body.sql).toBe('DELETE FROM "user"');
        expect(lowered.body.params).toEqual([]);
      });
    });

    describe('error handling', () => {
      it('throws error for unsupported AST kind', () => {
        const adapter = createPostgresAdapter();

        const ast = {
          kind: 'invalid' as 'select',
        } as QueryAst;

        expect(() => {
          adapter.lower(ast, { contract, params: [] });
        }).toThrow('Unsupported AST kind: invalid');
      });
    });

    describe('WHERE clause expressions', () => {
      it('lowers SELECT with EXISTS expression in WHERE clause', () => {
        const adapter = createPostgresAdapter();

        const ast: SelectAst = {
          kind: 'select',
          from: { kind: 'table', name: 'user' },
          project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
          where: {
            kind: 'exists',
            not: false,
            subquery: {
              kind: 'select',
              from: { kind: 'table', name: 'post' },
              project: [{ alias: 'id', expr: { kind: 'col', table: 'post', column: 'id' } }],
              where: {
                kind: 'bin',
                op: 'eq',
                left: { kind: 'col', table: 'post', column: 'userId' },
                right: { kind: 'param', index: 1, name: 'userId' },
              },
            },
          },
        };

        const lowered = adapter.lower(ast, { contract, params: [42] });

        expect(lowered.body.sql).toContain('EXISTS');
        expect(lowered.body.sql).toContain('SELECT "post"."id" AS "id" FROM "post"');
        expect(lowered.body.sql).toContain('WHERE "post"."userId" = $1');
      });

      it('lowers SELECT with NOT EXISTS expression in WHERE clause', () => {
        const adapter = createPostgresAdapter();

        const ast: SelectAst = {
          kind: 'select',
          from: { kind: 'table', name: 'user' },
          project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
          where: {
            kind: 'exists',
            not: true,
            subquery: {
              kind: 'select',
              from: { kind: 'table', name: 'post' },
              project: [{ alias: 'id', expr: { kind: 'col', table: 'post', column: 'id' } }],
              where: {
                kind: 'bin',
                op: 'eq',
                left: { kind: 'col', table: 'post', column: 'userId' },
                right: { kind: 'param', index: 1, name: 'userId' },
              },
            },
          },
        };

        const lowered = adapter.lower(ast, { contract, params: [42] });

        expect(lowered.body.sql).toContain('NOT EXISTS');
        expect(lowered.body.sql).toContain('SELECT "post"."id" AS "id" FROM "post"');
        expect(lowered.body.sql).toContain('WHERE "post"."userId" = $1');
      });

      it('lowers SELECT with AND expression in WHERE clause', () => {
        const adapter = createPostgresAdapter();

        const ast: SelectAst = {
          kind: 'select',
          from: { kind: 'table', name: 'user' },
          project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
          where: {
            kind: 'and',
            exprs: [
              {
                kind: 'bin',
                op: 'eq',
                left: { kind: 'col', table: 'user', column: 'id' },
                right: { kind: 'param', index: 1, name: 'id' },
              },
              {
                kind: 'bin',
                op: 'neq',
                left: { kind: 'col', table: 'user', column: 'email' },
                right: { kind: 'literal', value: '' },
              },
            ],
          },
        };

        const lowered = adapter.lower(ast, { contract, params: [42] });

        expect(lowered.body.sql).toContain('AND');
        expect(lowered.body.sql).toContain('"user"."id" = $1');
        expect(lowered.body.sql).toContain('"user"."email"');
      });

      it('lowers SELECT with OR expression in WHERE clause', () => {
        const adapter = createPostgresAdapter();

        const ast: SelectAst = {
          kind: 'select',
          from: { kind: 'table', name: 'user' },
          project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
          where: {
            kind: 'or',
            exprs: [
              {
                kind: 'bin',
                op: 'eq',
                left: { kind: 'col', table: 'user', column: 'id' },
                right: { kind: 'param', index: 1, name: 'id1' },
              },
              {
                kind: 'bin',
                op: 'eq',
                left: { kind: 'col', table: 'user', column: 'id' },
                right: { kind: 'param', index: 2, name: 'id2' },
              },
            ],
          },
        };

        const lowered = adapter.lower(ast, { contract, params: [1, 2] });

        expect(lowered.body.sql).toContain('OR');
        expect(lowered.body.sql).toContain('$1');
        expect(lowered.body.sql).toContain('$2');
      });

      it('lowers SELECT with like operator in WHERE clause', () => {
        const adapter = createPostgresAdapter();

        const ast: SelectAst = {
          kind: 'select',
          from: { kind: 'table', name: 'user' },
          project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
          where: {
            kind: 'bin',
            op: 'like',
            left: { kind: 'col', table: 'user', column: 'email' },
            right: { kind: 'param', index: 1, name: 'pattern' },
          },
        };

        const lowered = adapter.lower(ast, { contract, params: ['%@example.com'] });

        expect(lowered.body.sql).toContain('LIKE');
        expect(lowered.body.sql).toContain('$1');
      });

      it('lowers SELECT with ilike operator in WHERE clause', () => {
        const adapter = createPostgresAdapter();

        const ast: SelectAst = {
          kind: 'select',
          from: { kind: 'table', name: 'user' },
          project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
          where: {
            kind: 'bin',
            op: 'ilike',
            left: { kind: 'col', table: 'user', column: 'email' },
            right: { kind: 'param', index: 1, name: 'pattern' },
          },
        };

        const lowered = adapter.lower(ast, { contract, params: ['%@example.com'] });

        expect(lowered.body.sql).toContain('ILIKE');
      });

      it('lowers SELECT with in operator and list literal in WHERE clause', () => {
        const adapter = createPostgresAdapter();

        const ast: SelectAst = {
          kind: 'select',
          from: { kind: 'table', name: 'user' },
          project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
          where: {
            kind: 'bin',
            op: 'in',
            left: { kind: 'col', table: 'user', column: 'id' },
            right: {
              kind: 'listLiteral',
              values: [
                { kind: 'param', index: 1, name: 'id1' },
                { kind: 'param', index: 2, name: 'id2' },
              ],
            },
          },
        };

        const lowered = adapter.lower(ast, { contract, params: [1, 2] });

        expect(lowered.body.sql).toContain('IN');
        expect(lowered.body.sql).toContain('$1');
        expect(lowered.body.sql).toContain('$2');
      });

      it('lowers SELECT with notIn operator and literal list in WHERE clause', () => {
        const adapter = createPostgresAdapter();

        const ast: SelectAst = {
          kind: 'select',
          from: { kind: 'table', name: 'user' },
          project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
          where: {
            kind: 'bin',
            op: 'notIn',
            left: { kind: 'col', table: 'user', column: 'id' },
            right: {
              kind: 'listLiteral',
              values: [{ kind: 'literal', value: 0 }],
            },
          },
        };

        const lowered = adapter.lower(ast, { contract, params: [] });

        expect(lowered.body.sql).toContain('NOT IN');
        expect(lowered.body.sql).toContain('0');
      });
    });

    describe('operation expressions', () => {
      it('lowers SELECT with operation expression in projection', () => {
        const adapter = createPostgresAdapter();

        const ast: SelectAst = {
          kind: 'select',
          from: { kind: 'table', name: 'user' },
          project: [
            {
              alias: 'normalized',
              expr: {
                kind: 'operation',
                method: 'normalize',
                forTypeId: 'pg/vector@1',
                self: { kind: 'col', table: 'user', column: 'vector' },
                args: [],
                returns: { kind: 'typeId', type: 'pg/vector@1' },
                lowering: {
                  targetFamily: 'sql',
                  strategy: 'function',
                  // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
                  template: 'normalize(${self})',
                },
              },
            },
          ],
        };

        const lowered = adapter.lower(ast, { contract, params: [] });

        expect(lowered.body.sql).toContain('normalize("user"."vector")');
        expect(lowered.body.sql).toContain('AS "normalized"');
      });

      it('lowers SELECT with operation expression in include ORDER BY', () => {
        const adapter = createPostgresAdapter();

        const operationExpr = {
          kind: 'operation' as const,
          method: 'normalize',
          forTypeId: 'pg/vector@1',
          self: { kind: 'col' as const, table: 'post', column: 'vector' },
          args: [],
          returns: { kind: 'typeId' as const, type: 'pg/vector@1' },
          lowering: {
            targetFamily: 'sql' as const,
            strategy: 'function' as const,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
            template: 'normalize(${self})',
          },
        };

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
                orderBy: [{ expr: operationExpr, dir: 'asc' }],
              },
            },
          ],
          project: [
            { alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } },
            { alias: 'posts', expr: { kind: 'includeRef', alias: 'posts' } },
          ],
        };

        const lowered = adapter.lower(ast, { contract, params: [] });

        expect(lowered.body.sql).toContain('ORDER BY');
        expect(lowered.body.sql).toContain('normalize("post"."vector")');
        expect(lowered.body.sql).toContain('ASC');
      });
    });
  });

  describe('vector type casting', () => {
    const vectorContract = Object.freeze(
      validateContract<PostgresContract>({
        target: 'postgres',
        targetFamily: 'sql' as const,
        storageHash: 'sha256:test-core',
        profileHash: 'sha256:test-profile',
        storage: {
          tables: {
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                vector: { codecId: 'pg/vector@1', nativeType: 'vector', nullable: false },
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

    it('casts vector parameters in INSERT', () => {
      const adapter = createPostgresAdapter();

      const ast: InsertAst = {
        kind: 'insert',
        table: { kind: 'table', name: 'user' },
        values: {
          vector: { kind: 'param', index: 1, name: 'vector' },
        },
      };

      const lowered = adapter.lower(ast, {
        contract: vectorContract,
        params: [[1, 2, 3]],
      });

      expect(lowered.body.sql).toContain('$1::vector');
    });

    it('casts vector parameters in UPDATE', () => {
      const adapter = createPostgresAdapter();

      const ast: UpdateAst = {
        kind: 'update',
        table: { kind: 'table', name: 'user' },
        set: {
          vector: { kind: 'param', index: 1, name: 'vector' },
        },
        where: {
          kind: 'bin',
          op: 'eq',
          left: { kind: 'col', table: 'user', column: 'id' },
          right: { kind: 'param', index: 2, name: 'userId' },
        },
      };

      const lowered = adapter.lower(ast, {
        contract: vectorContract,
        params: [[1, 2, 3], 1],
      });

      expect(lowered.body.sql).toContain('$1::vector');
    });

    it('casts vector operation parameters', () => {
      const adapter = createPostgresAdapter();

      const ast: SelectAst = {
        kind: 'select',
        from: { kind: 'table', name: 'user' },
        project: [
          {
            alias: 'distance',
            expr: {
              kind: 'operation',
              method: 'distance',
              forTypeId: 'pg/vector@1',
              self: { kind: 'col', table: 'user', column: 'vector' },
              args: [{ kind: 'param', index: 1, name: 'queryVector' }],
              returns: { kind: 'typeId', type: 'pg/float8@1' },
              lowering: {
                targetFamily: 'sql',
                strategy: 'function',
                // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
                template: '${self} <=> ${arg0}',
              },
            },
          },
        ],
      };

      const lowered = adapter.lower(ast, {
        contract: vectorContract,
        params: [[1, 2, 3]],
      });

      expect(lowered.body.sql).toContain('$1::vector');
    });
  });

  describe('json type casting', () => {
    const jsonContract = Object.freeze(
      validateContract<PostgresContract>({
        target: 'postgres',
        targetFamily: 'sql' as const,
        storageHash: 'sha256:test-core',
        profileHash: 'sha256:test-profile',
        storage: {
          tables: {
            event: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                payload: { codecId: 'pg/jsonb@1', nativeType: 'jsonb', nullable: false },
                raw: { codecId: 'pg/json@1', nativeType: 'json', nullable: true },
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

    it('casts jsonb parameters in INSERT', () => {
      const adapter = createPostgresAdapter();

      const ast: InsertAst = {
        kind: 'insert',
        table: { kind: 'table', name: 'event' },
        values: {
          payload: { kind: 'param', index: 1, name: 'payload' },
        },
      };

      const lowered = adapter.lower(ast, {
        contract: jsonContract,
        params: [{ kind: 'created' }],
      });

      expect(lowered.body.sql).toContain('$1::jsonb');
    });

    it('casts json parameters in UPDATE', () => {
      const adapter = createPostgresAdapter();

      const ast: UpdateAst = {
        kind: 'update',
        table: { kind: 'table', name: 'event' },
        set: {
          raw: { kind: 'param', index: 1, name: 'raw' },
        },
        where: {
          kind: 'bin',
          op: 'eq',
          left: { kind: 'col', table: 'event', column: 'id' },
          right: { kind: 'param', index: 2, name: 'eventId' },
        },
      };

      const lowered = adapter.lower(ast, {
        contract: jsonContract,
        params: [{ source: 'legacy' }, 1],
      });

      expect(lowered.body.sql).toContain('$1::json');
    });
  });

  describe('literal rendering', () => {
    it('renders array literals', () => {
      const adapter = createPostgresAdapter();

      const ast: SelectAst = {
        kind: 'select',
        from: { kind: 'table', name: 'user' },
        project: [
          {
            alias: 'tags',
            expr: { kind: 'literal', value: ['tag1', 'tag2', 'tag3'] },
          },
        ],
      };

      const lowered = adapter.lower(ast, { contract, params: [] });

      expect(lowered.body.sql).toContain('ARRAY[');
      expect(lowered.body.sql).toContain("'tag1'");
      expect(lowered.body.sql).toContain("'tag2'");
      expect(lowered.body.sql).toContain("'tag3'");
    });

    it('renders object literals as JSON', () => {
      const adapter = createPostgresAdapter();

      const ast: SelectAst = {
        kind: 'select',
        from: { kind: 'table', name: 'user' },
        project: [
          {
            alias: 'metadata',
            expr: { kind: 'literal', value: { key: 'value', num: 42 } },
          },
        ],
      };

      const lowered = adapter.lower(ast, { contract, params: [] });

      expect(lowered.body.sql).toContain('{"key":"value","num":42}');
    });

    it('renders nested array literals', () => {
      const adapter = createPostgresAdapter();

      const ast: SelectAst = {
        kind: 'select',
        from: { kind: 'table', name: 'user' },
        project: [
          {
            alias: 'matrix',
            expr: {
              kind: 'literal',
              value: [
                [1, 2],
                [3, 4],
              ],
            },
          },
        ],
      };

      const lowered = adapter.lower(ast, { contract, params: [] });

      expect(lowered.body.sql).toContain('ARRAY[');
    });
  });

  describe('null check expressions', () => {
    it('renders IS NULL in SELECT query', () => {
      const adapter = createPostgresAdapter();

      const ast: SelectAst = {
        kind: 'select',
        from: { kind: 'table', name: 'user' },
        project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
        where: {
          kind: 'nullCheck',
          expr: { kind: 'col', table: 'user', column: 'email' },
          isNull: true,
        },
      };

      const lowered = adapter.lower(ast, { contract, params: [] });

      expect(lowered.body.sql).toBe(
        'SELECT "user"."id" AS "id" FROM "user" WHERE "user"."email" IS NULL',
      );
    });

    it('renders IS NOT NULL in SELECT query', () => {
      const adapter = createPostgresAdapter();

      const ast: SelectAst = {
        kind: 'select',
        from: { kind: 'table', name: 'user' },
        project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
        where: {
          kind: 'nullCheck',
          expr: { kind: 'col', table: 'user', column: 'email' },
          isNull: false,
        },
      };

      const lowered = adapter.lower(ast, { contract, params: [] });

      expect(lowered.body.sql).toBe(
        'SELECT "user"."id" AS "id" FROM "user" WHERE "user"."email" IS NOT NULL',
      );
    });

    it('renders IS NULL in UPDATE query', () => {
      const adapter = createPostgresAdapter();

      const ast: UpdateAst = {
        kind: 'update',
        table: { kind: 'table', name: 'user' },
        set: {
          email: { kind: 'param', index: 1, name: 'email' },
        },
        where: {
          kind: 'nullCheck',
          expr: { kind: 'col', table: 'user', column: 'createdAt' },
          isNull: true,
        },
      };

      const lowered = adapter.lower(ast, { contract, params: ['new@email.com'] });

      expect(lowered.body.sql).toBe(
        'UPDATE "user" SET "email" = $1 WHERE "user"."createdAt" IS NULL',
      );
    });

    it('renders IS NOT NULL in DELETE query', () => {
      const adapter = createPostgresAdapter();

      const ast: DeleteAst = {
        kind: 'delete',
        table: { kind: 'table', name: 'user' },
        where: {
          kind: 'nullCheck',
          expr: { kind: 'col', table: 'user', column: 'id' },
          isNull: false,
        },
      };

      const lowered = adapter.lower(ast, { contract, params: [] });

      expect(lowered.body.sql).toBe('DELETE FROM "user" WHERE "user"."id" IS NOT NULL');
    });
  });
});
