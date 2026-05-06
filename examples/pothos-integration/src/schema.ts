import type { Runtime } from '@prisma-next/sql-runtime';
import { createBuilder } from './builder';
import { PRISMA_NEXT_COLUMNS } from './plugin/types';

/**
 * The demo Pothos schema. Defines `User`, `Post`, `Comment` mirroring the
 * Pothos author's published example schema, plus a couple of root queries
 * that demonstrate the canonical auto-include flow AND the M2 headline
 * differentiator: drafts + posts as siblings on the same prisma-next
 * relation, plus a peer postCount field.
 */
export function buildSchema(runtime: Runtime) {
  const { builder } = createBuilder(runtime);

  builder.prismaObject('User', {
    fields: (t) => ({
      id: t.exposeID('id'),
      firstName: t.exposeString('firstName'),
      lastName: t.exposeString('lastName'),
      email: t.exposeString('email'),
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
      id: t.exposeID('id'),
      title: t.exposeString('title'),
      content: t.exposeString('content'),
      // The contract stores `published` as an integer (0/1) — sqlite has no
      // boolean codec — but the GraphQL surface advertises a Boolean here.
      // Computed resolver, so the column dependency is declared explicitly
      // for the auto-include walker (an `exposeX` field would set this
      // automatically via `pothosExposedField`).
      published: t.field({
        type: 'Boolean',
        resolve: (parent) => Boolean(parent.published),
        extensions: { [PRISMA_NEXT_COLUMNS]: ['published'] },
      }),
      author: t.relation('author'),
      comments: t.relation('comments'),
    }),
  });

  builder.prismaObject('Comment', {
    fields: (t) => ({
      id: t.exposeID('id'),
      body: t.exposeString('body'),
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
          collection.where({ id: args.id }).all().firstOrThrow(),
      }),
    }),
  });

  return builder.toSchema();
}
