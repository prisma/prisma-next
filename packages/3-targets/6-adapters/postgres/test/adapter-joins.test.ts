import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SelectAst } from '@prisma-next/sql-relational-core/ast';
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
  }),
);

describe('Postgres adapter join rendering', () => {
  it('renders INNER JOIN correctly', () => {
    const adapter = createPostgresAdapter();

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      joins: [
        {
          kind: 'join',
          joinType: 'inner',
          table: { kind: 'table', name: 'post' },
          on: {
            kind: 'eqCol',
            left: { kind: 'col', table: 'user', column: 'id' },
            right: { kind: 'col', table: 'post', column: 'userId' },
          },
        },
      ],
      project: [
        { alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } },
        { alias: 'title', expr: { kind: 'col', table: 'post', column: 'title' } },
      ],
    };

    const lowered = adapter.lower(ast, { contract, params: [] });

    expect(lowered.body.sql).toBe(
      'SELECT "user"."id" AS "id", "post"."title" AS "title" FROM "user" INNER JOIN "post" ON "user"."id" = "post"."userId"',
    );
  });

  it('renders LEFT JOIN correctly', () => {
    const adapter = createPostgresAdapter();

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      joins: [
        {
          kind: 'join',
          joinType: 'left',
          table: { kind: 'table', name: 'post' },
          on: {
            kind: 'eqCol',
            left: { kind: 'col', table: 'user', column: 'id' },
            right: { kind: 'col', table: 'post', column: 'userId' },
          },
        },
      ],
      project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
    };

    const lowered = adapter.lower(ast, { contract, params: [] });

    expect(lowered.body.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" LEFT JOIN "post" ON "user"."id" = "post"."userId"',
    );
  });

  it('renders RIGHT JOIN correctly', () => {
    const adapter = createPostgresAdapter();

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      joins: [
        {
          kind: 'join',
          joinType: 'right',
          table: { kind: 'table', name: 'post' },
          on: {
            kind: 'eqCol',
            left: { kind: 'col', table: 'user', column: 'id' },
            right: { kind: 'col', table: 'post', column: 'userId' },
          },
        },
      ],
      project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
    };

    const lowered = adapter.lower(ast, { contract, params: [] });

    expect(lowered.body.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" RIGHT JOIN "post" ON "user"."id" = "post"."userId"',
    );
  });

  it('renders FULL JOIN correctly', () => {
    const adapter = createPostgresAdapter();

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      joins: [
        {
          kind: 'join',
          joinType: 'full',
          table: { kind: 'table', name: 'post' },
          on: {
            kind: 'eqCol',
            left: { kind: 'col', table: 'user', column: 'id' },
            right: { kind: 'col', table: 'post', column: 'userId' },
          },
        },
      ],
      project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
    };

    const lowered = adapter.lower(ast, { contract, params: [] });

    expect(lowered.body.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" FULL JOIN "post" ON "user"."id" = "post"."userId"',
    );
  });

  it('renders multiple chained joins correctly', () => {
    const adapter = createPostgresAdapter();

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      joins: [
        {
          kind: 'join',
          joinType: 'inner',
          table: { kind: 'table', name: 'post' },
          on: {
            kind: 'eqCol',
            left: { kind: 'col', table: 'user', column: 'id' },
            right: { kind: 'col', table: 'post', column: 'userId' },
          },
        },
        {
          kind: 'join',
          joinType: 'left',
          table: { kind: 'table', name: 'comment' },
          on: {
            kind: 'eqCol',
            left: { kind: 'col', table: 'post', column: 'id' },
            right: { kind: 'col', table: 'comment', column: 'postId' },
          },
        },
      ],
      project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
    };

    const lowered = adapter.lower(ast, { contract, params: [] });

    expect(lowered.body.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" INNER JOIN "post" ON "user"."id" = "post"."userId" LEFT JOIN "comment" ON "post"."id" = "comment"."postId"',
    );
  });

  it('renders joins with WHERE clause correctly', () => {
    const adapter = createPostgresAdapter();

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      joins: [
        {
          kind: 'join',
          joinType: 'inner',
          table: { kind: 'table', name: 'post' },
          on: {
            kind: 'eqCol',
            left: { kind: 'col', table: 'user', column: 'id' },
            right: { kind: 'col', table: 'post', column: 'userId' },
          },
        },
      ],
      project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
      where: {
        kind: 'bin',
        op: 'eq',
        left: { kind: 'col', table: 'user', column: 'id' },
        right: { kind: 'param', index: 1, name: 'userId' },
      },
    };

    const lowered = adapter.lower(ast, { contract, params: [42] });

    expect(lowered.body.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" INNER JOIN "post" ON "user"."id" = "post"."userId" WHERE "user"."id" = $1',
    );
    expect(lowered.body.params).toEqual([42]);
  });

  it('renders joins with ORDER BY and LIMIT correctly', () => {
    const adapter = createPostgresAdapter();

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      joins: [
        {
          kind: 'join',
          joinType: 'inner',
          table: { kind: 'table', name: 'post' },
          on: {
            kind: 'eqCol',
            left: { kind: 'col', table: 'user', column: 'id' },
            right: { kind: 'col', table: 'post', column: 'userId' },
          },
        },
      ],
      project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
      orderBy: [
        {
          expr: { kind: 'col', table: 'post', column: 'id' },
          dir: 'desc',
        },
      ],
      limit: 10,
    };

    const lowered = adapter.lower(ast, { contract, params: [] });

    expect(lowered.body.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" INNER JOIN "post" ON "user"."id" = "post"."userId" ORDER BY "post"."id" DESC LIMIT 10',
    );
  });

  it('throws error for unsupported join ON expression kind', () => {
    const adapter = createPostgresAdapter();

    const ast: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      joins: [
        {
          kind: 'join',
          joinType: 'inner',
          table: { kind: 'table', name: 'post' },
          on: {
            // @ts-expect-error - Testing unsupported join ON expression kind
            kind: 'unsupported',
            left: { kind: 'col', table: 'user', column: 'id' },
            right: { kind: 'col', table: 'post', column: 'userId' },
          },
        },
      ],
      project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
    };

    expect(() => adapter.lower(ast, { contract, params: [] })).toThrow(
      'Unsupported join ON expression kind: unsupported',
    );
  });
});
