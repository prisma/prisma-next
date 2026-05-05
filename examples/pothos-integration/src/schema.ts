import type { Runtime } from '@prisma-next/sql-runtime';
import { createBuilder } from './builder';

/**
 * The demo Pothos schema. Defines `User`, `Post`, `Comment` mirroring the
 * Pothos author's published example schema, plus a couple of root queries
 * that demonstrate the canonical auto-include flow AND the M2 headline
 * differentiator: drafts + posts as siblings on the same prisma-next
 * relation, plus a peer postCount field.
 *
 * Uses `t.field({ type: 'X', resolve })` instead of `t.exposeX` because the
 * loose `Record<string, unknown>` parent shape we hand to `prismaObject`
 * doesn't satisfy Pothos's `CompatibleTypes` constraint on exposeX. See
 * workarounds.md W-2.
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
      // Plain include — single GraphQL field on `posts` relation.
      posts: t.relation('posts'),
      comments: t.relation('comments'),
      // Sibling-aliased relation: `drafts` + `publishedPosts` both back
      // the same `posts` relation with different filters. The walker
      // collapses them into a single `.include('posts', p => p.combine({...}))`.
      // The wrapResolve reshape lifts each branch onto the parent.
      drafts: t.relation('posts', {
        query: { where: { published: 0 } },
      }),
      publishedPosts: t.relation('posts', {
        query: { where: { published: 1 } },
      }),
      // Peer count field — emitted as a `count()` branch in the same
      // combine block as `drafts` / `publishedPosts`.
      postCount: t.relationCount('posts'),
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
