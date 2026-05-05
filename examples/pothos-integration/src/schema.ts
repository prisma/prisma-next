import type { Runtime } from '@prisma-next/sql-runtime';
import { createBuilder } from './builder';

/**
 * The demo Pothos schema. Defines `User`, `Post`, `Comment` mirroring the
 * Pothos author's published example schema, plus a couple of root queries
 * that demonstrate the canonical auto-include flow.
 *
 * Uses `t.field({ type: 'X', resolve })` instead of `t.exposeX` because the
 * loose `Record<string, unknown>` parent shape we hand to `prismaObject`
 * doesn't satisfy Pothos's `CompatibleTypes` constraint on exposeX. A v2
 * with per-model row inference would unlock exposeX everywhere.
 */
export function buildSchema(runtime: Runtime) {
  const { builder } = createBuilder(runtime);

  builder.prismaObject('User', {
    fields: (t) => ({
      id: t.field({
        type: 'ID',
        resolve: (parent) => (parent as Record<string, unknown>)['id'] as string,
      }),
      firstName: t.field({
        type: 'String',
        resolve: (parent) => (parent as Record<string, unknown>)['firstName'] as string,
      }),
      lastName: t.field({
        type: 'String',
        resolve: (parent) => (parent as Record<string, unknown>)['lastName'] as string,
      }),
      email: t.field({
        type: 'String',
        resolve: (parent) => (parent as Record<string, unknown>)['email'] as string,
      }),
      posts: t.relation('posts'),
      comments: t.relation('comments'),
    }),
  });

  builder.prismaObject('Post', {
    fields: (t) => ({
      id: t.field({
        type: 'ID',
        resolve: (parent) => (parent as Record<string, unknown>)['id'] as string,
      }),
      title: t.field({
        type: 'String',
        resolve: (parent) => (parent as Record<string, unknown>)['title'] as string,
      }),
      content: t.field({
        type: 'String',
        resolve: (parent) => (parent as Record<string, unknown>)['content'] as string,
      }),
      published: t.field({
        type: 'Boolean',
        resolve: (parent) => Boolean((parent as Record<string, unknown>)['published']),
      }),
      author: t.relation('author'),
      comments: t.relation('comments'),
    }),
  });

  builder.prismaObject('Comment', {
    fields: (t) => ({
      id: t.field({
        type: 'ID',
        resolve: (parent) => (parent as Record<string, unknown>)['id'] as string,
      }),
      body: t.field({
        type: 'String',
        resolve: (parent) => (parent as Record<string, unknown>)['body'] as string,
      }),
      author: t.relation('author'),
      post: t.relation('post'),
    }),
  });

  builder.queryType({
    fields: (t) => ({
      users: t.prismaField({
        type: 'User',
        resolve: (collection) => collection.all().firstOrThrow(),
      }),
      userById: t.prismaField({
        type: 'User',
        args: {
          id: t.arg.string({ required: true }),
        },
        resolve: (collection, _root, args) =>
          (
            collection as unknown as {
              where: (w: unknown) => {
                all: () => { firstOrThrow: () => Promise<unknown> };
              };
            }
          )
            .where({ id: args.id })
            .all()
            .firstOrThrow(),
      }),
    }),
  });

  return builder.toSchema();
}
