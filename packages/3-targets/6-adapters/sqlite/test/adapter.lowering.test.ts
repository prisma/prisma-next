import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SelectAst } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';

import { createSqliteAdapter } from '../src/core/adapter';
import type { SqliteContract } from '../src/core/types';

const contract = Object.freeze(
  validateContract<SqliteContract>({
    target: 'sqlite',
    targetFamily: 'sql' as const,
    coreHash: 'sha256:test-core',
    profileHash: 'sha256:test-profile',
    storage: {
      tables: {
        user: {
          columns: {
            id: { codecId: 'sqlite/int@1', nativeType: 'integer', nullable: false },
            email: { codecId: 'sqlite/text@1', nativeType: 'text', nullable: false },
            createdAt: { codecId: 'sqlite/datetime@1', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
        post: {
          columns: {
            id: { codecId: 'sqlite/int@1', nativeType: 'integer', nullable: false },
            title: { codecId: 'sqlite/text@1', nativeType: 'text', nullable: false },
            userId: { codecId: 'sqlite/int@1', nativeType: 'integer', nullable: false },
            createdAt: { codecId: 'sqlite/datetime@1', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [{ columns: ['userId'], references: { table: 'user', columns: ['id'] } }],
        },
      },
    },
    models: {},
    relations: {},
    mappings: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
  }),
);

describe('createSqliteAdapter', () => {
  it('lowers select AST into canonical SQL with numeric params', () => {
    const adapter = createSqliteAdapter();

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
      sql: 'SELECT "user"."id" AS "id", "user"."email" AS "email" FROM "user" WHERE "user"."id" = ?1 ORDER BY "user"."createdAt" DESC LIMIT 5',
      params: [42],
    });
  });

  it('renders includeMany using correlated subquery + JSON1', () => {
    const adapter = createSqliteAdapter();

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
            limit: 10,
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

    expect(result.body.sql).toContain('coalesce((');
    expect(result.body.sql).toContain('json_group_array');
    expect(result.body.sql).toContain('json_object');
    expect(result.body.sql).toContain('FROM "post"');
    expect(result.body.sql).toContain('WHERE "user"."id" = "post"."userId"');
    expect(result.body.sql).toContain('ORDER BY "post"."createdAt" DESC');
    expect(result.body.sql).toContain('LIMIT 10');
    expect(result.body.sql).toContain('AS "posts"');
  });
});
