import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '@prisma-next/sql-lane/sql';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { executePlanAndCollect } from '@prisma-next/sql-runtime/test/utils';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { withTestRuntime } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

describe('end-to-end nested projection queries', () => {
  it(
    'nested projection returns flat rows with correct aliases',
    async () => {
      await withTestRuntime<Contract>(
        contractJsonPath,
        async ({ tables, runtime, context, client }) => {
          await client.query('insert into "user" (email) values ($1), ($2), ($3)', [
            'ada@example.com',
            'tess@example.com',
            'mike@example.com',
          ]);

          const user = tables.user!;
          const plan = sql({ context })
            .from(user)
            .select({
              name: user.columns.email!,
              post: {
                title: user.columns.id!,
              },
            })
            .build();

          const rows = await executePlanAndCollect(runtime, plan);

          expect(rows.length).toBe(3);
          expect(rows[0]).toMatchObject({
            name: expect.any(String),
            post_title: expect.any(Number),
          });
          expect(rows[0]).toEqual(expect.not.objectContaining({ post: expect.anything() }));

          type Row = ResultType<typeof plan>;
          expectTypeOf<Row>().toExtend<{
            name: string;
            post: { title: number };
          }>();

          const flatRow0 = (rows[0] ?? {}) as Record<string, unknown>;
          expect(flatRow0['name']).toBe('ada@example.com');
          expect(flatRow0['post_title']).toBe(1);
          expect({
            name: flatRow0['name'],
            post: { title: flatRow0['post_title'] },
          }).toEqual({
            name: 'ada@example.com',
            post: { title: 1 },
          });

          expect(plan.meta.projection).toEqual({
            name: 'user.email',
            post_title: 'user.id',
          });

          expect(plan.meta.projectionTypes).toEqual({
            name: 'sql/varchar@1',
            post_title: 'pg/int4@1',
          });
        },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'multi-level nested projection returns flat rows with correct aliases',
    async () => {
      await withTestRuntime<Contract>(
        contractJsonPath,
        async ({ tables, runtime, context, client }) => {
          await client.query('insert into "user" (email) values ($1), ($2)', [
            'ada@example.com',
            'tess@example.com',
          ]);

          const user = tables.user!;
          const plan = sql({ context })
            .from(user)
            .select({
              a: {
                b: {
                  c: user.columns.id!,
                },
              },
            })
            .build();

          const rows = await executePlanAndCollect(runtime, plan);

          expect(rows.length).toBe(2);
          expect(rows[0]).toMatchObject({
            a_b_c: expect.any(Number),
          });
          expect(rows[0]).toEqual(expect.not.objectContaining({ a: expect.anything() }));

          type Row = ResultType<typeof plan>;
          expectTypeOf<Row>().toExtend<{
            a: { b: { c: number } };
          }>();

          const flatRow0 = (rows[0] ?? {}) as Record<string, unknown>;
          expect(flatRow0['a_b_c']).toBe(1);

          const flatRow1 = (rows[1] ?? {}) as Record<string, unknown>;
          expect(flatRow1['a_b_c']).toBe(2);

          expect(plan.meta.projection).toEqual({
            a_b_c: 'user.id',
          });
        },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'nested projection with joins returns flat rows with correct aliases',
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

          const user = tables.user!;
          const post = tables.post!;
          const plan = sql({ context })
            .from(user)
            .innerJoin(post, (on) => on.eqCol(user.columns.id!, post.columns.userId!))
            .select({
              name: user.columns.email!,
              post: {
                title: post.columns.title!,
                id: post.columns.id!,
              },
            })
            .build();

          const rows = await executePlanAndCollect(runtime, plan);

          expect(rows.length).toBe(2);
          expect(rows[0]).toMatchObject({
            name: expect.any(String),
            post_title: expect.any(String),
            post_id: expect.any(Number),
          });
          expect(rows[0]).toEqual(expect.not.objectContaining({ post: expect.anything() }));

          type Row = ResultType<typeof plan>;
          expectTypeOf<Row>({} as Row).toExtend<{
            name: string;
            post: { title: string; id: number };
          }>();
          expectTypeOf<Row['name']>({} as Row['name']).toExtend<string>();
          expectTypeOf<Row['post']>({} as Row['post']).toEqualTypeOf({} as Row['post']);
          expectTypeOf<Row['post']['title']>({} as Row['post']['title']).toExtend<string>();
          expectTypeOf<Row['post']['id']>({} as Row['post']['id']).toEqualTypeOf(
            0 as Row['post']['id'],
          );

          const flatRow0 = (rows[0] ?? {}) as Record<string, unknown>;
          expect(flatRow0['name']).toBe('ada@example.com');
          expect(flatRow0['post_title']).toBe('First Post');
          expect(flatRow0['post_id']).toBe(1);
          expect({
            name: flatRow0['name'],
            post: { title: flatRow0['post_title'], id: flatRow0['post_id'] },
          }).toEqual({
            name: 'ada@example.com',
            post: { title: 'First Post', id: 1 },
          });

          expect(plan.meta.projection).toEqual({
            name: 'user.email',
            post_title: 'post.title',
            post_id: 'post.id',
          });

          expect(plan.meta.refs?.tables).toContain('user');
          expect(plan.meta.refs?.tables).toContain('post');
        },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'mixed leaves and nested objects in projection returns flat rows',
    async () => {
      await withTestRuntime<Contract>(
        contractJsonPath,
        async ({ tables, runtime, context, client }) => {
          await client.query('insert into "user" (email) values ($1), ($2)', [
            'ada@example.com',
            'tess@example.com',
          ]);

          const user = tables.user!;
          const plan = sql({ context })
            .from(user)
            .select({
              id: user.columns.id!,
              post: {
                title: user.columns.email!,
                author: {
                  name: user.columns.id!,
                },
              },
              email: user.columns.email!,
            })
            .build();

          const rows = await executePlanAndCollect(runtime, plan);

          expect(rows.length).toBe(2);
          expect(rows[0]).toMatchObject({
            id: expect.any(Number),
            post_title: expect.any(String),
            post_author_name: expect.any(Number),
            email: expect.any(String),
          });
          expect(rows[0]).toEqual(expect.not.objectContaining({ post: expect.anything() }));

          type Row = ResultType<typeof plan>;
          expectTypeOf<Row>({} as Row).toExtend<{
            id: number;
            post: { title: string; author: { name: number } };
            email: string;
          }>();
          expectTypeOf<Row['id']>({} as Row['id']).toEqualTypeOf(0 as Row['id']);
          expectTypeOf<Row['post']>({} as Row['post']).toEqualTypeOf({} as Row['post']);
          expectTypeOf<Row['post']['title']>({} as Row['post']['title']).toExtend<string>();
          expectTypeOf<Row['post']['author']>({} as Row['post']['author']).toEqualTypeOf(
            {} as Row['post']['author'],
          );
          expectTypeOf<Row['post']['author']['name']>(
            {} as Row['post']['author']['name'],
          ).toEqualTypeOf(0 as Row['post']['author']['name']);
          expectTypeOf<Row['email']>({} as Row['email']).toExtend<string>();

          const flatRow0 = (rows[0] ?? {}) as Record<string, unknown>;
          expect(flatRow0['id']).toBe(1);
          expect(flatRow0['post_title']).toBe('ada@example.com');
          expect(flatRow0['post_author_name']).toBe(1);
          expect(flatRow0['email']).toBe('ada@example.com');
          expect({
            id: flatRow0['id'],
            post: {
              title: flatRow0['post_title'],
              author: { name: flatRow0['post_author_name'] },
            },
            email: flatRow0['email'],
          }).toEqual({
            id: 1,
            post: { title: 'ada@example.com', author: { name: 1 } },
            email: 'ada@example.com',
          });

          expect(plan.meta.projection).toEqual({
            id: 'user.id',
            post_title: 'user.email',
            post_author_name: 'user.id',
            email: 'user.email',
          });
        },
      );
    },
    timeouts.spinUpPpgDev,
  );
});
