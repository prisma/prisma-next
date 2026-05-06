import type { Runtime } from '@prisma-next/sql-runtime';
import { createBuilder } from './builder';

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
        query: (rel) => rel.where({ published: 0 }),
      }),
      publishedPosts: t.relation('posts', {
        query: (rel) => rel.where({ published: 1 }),
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
      // Contract types `published` as `integerColumn`, so the GraphQL surface
      // is `Int!` and `t.exposeInt('published')` typechecks. A real `Boolean`
      // surface needs a `booleanColumn` in the sqlite adapter (which doesn't
      // exist yet — flagged as an adapter gap in the README's prisma-next
      // limitations section).
      published: t.exposeInt('published'),
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
