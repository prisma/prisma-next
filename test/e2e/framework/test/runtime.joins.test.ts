import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '@prisma-next/sql-lane/sql';
import type { SelectAst } from '@prisma-next/sql-relational-core/ast';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { executePlanAndCollect } from '@prisma-next/sql-runtime/test/utils';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { withTestRuntime } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

describe('end-to-end JOIN queries', () => {
  it(
    'INNER JOIN returns matching rows',
    async () => {
      await withTestRuntime<Contract>(
        contractJsonPath,
        async ({ tables, runtime, context, client }) => {
          await client.query('insert into "user" (email) values ($1), ($2), ($3)', [
            'ada@example.com',
            'tess@example.com',
            'mike@example.com',
          ]);
          await client.query(
            'insert into "post" ("userId", title, published) values ($1, $2, $3), ($1, $4, $5), ($6, $7, $8)',
            [1, 'First Post', true, 'Second Post', false, 2, 'Third Post', true],
          );

          const user = tables.user!;
          const post = tables.post!;
          const plan = sql({ context })
            .from(user)
            .innerJoin(post, (on) => on.eqCol(user.columns.id!, post.columns.userId!))
            .select({
              userId: user.columns.id!,
              email: user.columns.email!,
              postId: post.columns.id!,
              title: post.columns.title!,
            })
            .build();

          const rows = await executePlanAndCollect(runtime, plan);

          expect(rows.length).toBe(3);
          expect(rows[0]).toMatchObject({
            userId: expect.any(Number),
            email: expect.any(String),
            postId: expect.any(Number),
            title: expect.any(String),
          });

          expect(plan.meta.refs?.tables).toContain('user');
          expect(plan.meta.refs?.tables).toContain('post');
          expect(plan.meta.refs?.columns).toEqual(
            expect.arrayContaining([
              { table: 'user', column: 'id' },
              { table: 'post', column: 'userId' },
            ]),
          );
        },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'LEFT JOIN returns all users including those without posts',
    async () => {
      await withTestRuntime<Contract>(
        contractJsonPath,
        async ({ tables, runtime, context, client }) => {
          await client.query('insert into "user" (email) values ($1), ($2), ($3)', [
            'ada@example.com',
            'tess@example.com',
            'mike@example.com',
          ]);
          await client.query(
            'insert into "post" ("userId", title, published) values ($1, $2, $3)',
            [1, 'First Post', true],
          );

          const user = tables.user!;
          const post = tables.post!;
          const plan = sql({ context })
            .from(user)
            .leftJoin(post, (on) => on.eqCol(user.columns.id!, post.columns.userId!))
            .select({
              userId: user.columns.id!,
              email: user.columns.email!,
              postId: post.columns.id!,
              title: post.columns.title!,
            })
            .build();

          const rows = await executePlanAndCollect(runtime, plan);
          type Row = ResultType<typeof plan>;

          expect(rows.length).toBe(3);
          const adaRow = rows.find((r: Row) => r.email === 'ada@example.com');
          const tessRow = rows.find((r: Row) => r.email === 'tess@example.com');
          const mikeRow = rows.find((r: Row) => r.email === 'mike@example.com');

          expect(adaRow).toMatchObject({
            email: 'ada@example.com',
            postId: expect.anything(),
            title: expect.anything(),
          });

          expect(tessRow).toMatchObject({
            email: 'tess@example.com',
            postId: null,
            title: null,
          });

          expect(mikeRow).toMatchObject({
            email: 'mike@example.com',
            postId: null,
            title: null,
          });

          expect(plan.meta.refs?.tables).toContain('user');
          expect(plan.meta.refs?.tables).toContain('post');
        },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'RIGHT JOIN returns all posts including those without users',
    async () => {
      await withTestRuntime<Contract>(
        contractJsonPath,
        async ({ tables, runtime, context, client }) => {
          await client.query('insert into "user" (email) values ($1)', ['ada@example.com']);
          await client.query(
            'insert into "post" ("userId", title, published) values ($1, $2, $3), ($4, $5, $6)',
            [1, 'First Post', true, 999, 'Orphan Post', true],
          );

          const user = tables.user!;
          const post = tables.post!;
          const plan = sql({ context })
            .from(user)
            .rightJoin(post, (on) => on.eqCol(user.columns.id!, post.columns.userId!))
            .select({
              userId: user.columns.id!,
              email: user.columns.email!,
              postId: post.columns.id!,
              title: post.columns.title!,
            })
            .build();

          const rows = await executePlanAndCollect(runtime, plan);
          type Row = ResultType<typeof plan>;

          expect(rows.length).toBe(2);
          const firstPostRow = rows.find((r: Row) => r.title === 'First Post');
          const orphanPostRow = rows.find((r: Row) => r.title === 'Orphan Post');

          expect(firstPostRow).toMatchObject({
            title: 'First Post',
            userId: expect.anything(),
            email: expect.anything(),
          });

          expect(orphanPostRow).toMatchObject({
            title: 'Orphan Post',
            userId: null,
            email: null,
          });

          expect(plan.meta.refs?.tables).toContain('user');
          expect(plan.meta.refs?.tables).toContain('post');
        },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'FULL JOIN returns all users and posts',
    async () => {
      await withTestRuntime<Contract>(
        contractJsonPath,
        async ({ tables, runtime, context, client }) => {
          await client.query('insert into "user" (email) values ($1), ($2)', [
            'ada@example.com',
            'tess@example.com',
          ]);
          await client.query(
            'insert into "post" ("userId", title, published) values ($1, $2, $3), ($4, $5, $6)',
            [1, 'First Post', true, 999, 'Orphan Post', true],
          );

          const user = tables.user!;
          const post = tables.post!;
          const plan = sql({ context })
            .from(user)
            .fullJoin(post, (on) => on.eqCol(user.columns.id!, post.columns.userId!))
            .select({
              userId: user.columns.id!,
              email: user.columns.email!,
              postId: post.columns.id!,
              title: post.columns.title!,
            })
            .build();

          const rows = await executePlanAndCollect(runtime, plan);
          type Row = ResultType<typeof plan>;

          expect(rows.length).toBe(3);
          const adaRow = rows.find((r: Row) => r.email === 'ada@example.com');
          const tessRow = rows.find((r: Row) => r.email === 'tess@example.com');
          const orphanRow = rows.find((r: Row) => r.title === 'Orphan Post');

          expect(adaRow).toMatchObject({
            email: 'ada@example.com',
            postId: expect.anything(),
          });

          expect(tessRow).toMatchObject({
            email: 'tess@example.com',
            postId: null,
          });

          expect(orphanRow).toMatchObject({
            title: 'Orphan Post',
            userId: null,
            email: null,
          });

          expect(plan.meta.refs?.tables).toContain('user');
          expect(plan.meta.refs?.tables).toContain('post');
        },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'chained joins (user -> post -> comment) returns correct results',
    async () => {
      await withTestRuntime<Contract>(
        contractJsonPath,
        async ({ tables, runtime, context, client }) => {
          await client.query('insert into "user" (email) values ($1), ($2)', [
            'ada@example.com',
            'tess@example.com',
          ]);
          await client.query(
            'insert into "post" ("userId", title, published) values ($1, $2, $3), ($1, $4, $5)',
            [1, 'First Post', true, 'Second Post', false],
          );
          await client.query(
            'insert into "comment" ("postId", content) values ($1, $2), ($1, $3)',
            [1, 'First Comment', 'Second Comment'],
          );

          const user = tables.user!;
          const post = tables.post!;
          const comment = tables.comment!;
          const plan = sql({ context })
            .from(user)
            .innerJoin(post, (on) => on.eqCol(user.columns.id!, post.columns.userId!))
            .leftJoin(comment, (on) => on.eqCol(post.columns.id!, comment.columns.postId!))
            .select({
              userId: user.columns.id!,
              email: user.columns.email!,
              postId: post.columns.id!,
              title: post.columns.title!,
              commentId: comment.columns.id!,
              content: comment.columns.content!,
            })
            .build();

          const ast = plan.ast as SelectAst | undefined;
          expect(ast?.joins).toMatchObject([
            {
              kind: 'join',
              joinType: 'inner',
              table: { kind: 'table', name: 'post' },
            },
            {
              kind: 'join',
              joinType: 'left',
              table: { kind: 'table', name: 'comment' },
            },
          ]);

          const rows = await executePlanAndCollect(runtime, plan);
          type Row = ResultType<typeof plan>;

          expect(rows.length).toBe(3);
          const firstPostRow = rows.find(
            (r: Row) => r.title === 'First Post' && r.commentId !== null,
          );
          const secondPostRow = rows.find((r: Row) => r.title === 'Second Post');

          expect(firstPostRow).toMatchObject({
            title: 'First Post',
            commentId: expect.anything(),
            content: expect.anything(),
          });

          expect(secondPostRow).toMatchObject({
            title: 'Second Post',
            commentId: null,
            content: null,
          });

          expect(plan.meta.refs?.tables).toContain('user');
          expect(plan.meta.refs?.tables).toContain('post');
          expect(plan.meta.refs?.tables).toContain('comment');
          expect(plan.meta.refs?.columns).toEqual(
            expect.arrayContaining([
              { table: 'user', column: 'id' },
              { table: 'post', column: 'userId' },
              { table: 'post', column: 'id' },
              { table: 'comment', column: 'postId' },
            ]),
          );
        },
      );
    },
    timeouts.spinUpPpgDev,
  );
});
