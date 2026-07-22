import { describe, expect, it } from 'vitest';
import type { Contract } from '../../_fixtures/blog-update/generated/contract';
import contractJson from '../../_fixtures/blog-update/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withPostgresPort } from '../../_harness/postgres';

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/blog-update
// (postgres matrix entry).
//
// Original tests (4 total):
//   1. "should create a user and update that field on that user"
//   2. "should create a user and post and connect them together"
//   3. "should create a user and post and disconnect them"
//   4. "should create a user with posts and a profile and update itself and nested connections
//       setting fields to null" — NOT PORTED: requires nested `profile: { update: {...} }` and
//       `posts: { updateMany: { data, where } }` which are not supported by the
//       prisma-next ORM's update API (only create/connect/disconnect are supported).
//
// Schema translation notes:
//   - `Post.authorId @map("author")` → column name "author", field name "authorId"
//   - `Post.updatedAt @updatedAt` → field.temporal.updatedAt() (auto-managed)
//   - `Post.createdAt @default(now())` → defaultSql('now()') — optional in create
//   - Prisma does NOT snake_case names: table "User", "Post", "Profile"
//   - All ids are text with no default → must be supplied explicitly in tests

const DDL = [
  `create table "User" (
    "id" text primary key,
    "email" text not null unique,
    "name" text,
    "wakesUpAt" timestamptz default now(),
    "lastLoginAt" timestamptz default now()
  )`,
  `create table "Profile" (
    "id" text primary key,
    "bio" text,
    "notrequired" text,
    "userId" text not null unique,
    "goesToBedAt" timestamptz default now(),
    "goesToOfficeAt" timestamptz default now(),
    constraint "Profile_userId_fkey" foreign key ("userId") references "User"("id")
  )`,
  `create table "Post" (
    "id" text primary key,
    "createdAt" timestamptz not null default now(),
    "updatedAt" timestamptz not null,
    "published" boolean not null,
    "title" text not null,
    "content" text,
    "optional" text,
    "author" text,
    "lastReviewedAt" timestamptz default now(),
    "lastPublishedAt" timestamptz default now(),
    constraint "Post_author_fkey" foreign key ("author") references "User"("id")
  )`,
];

function withBlogUpdate(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson, ddl: DDL }, fn);
}

describe('ports/prisma/functional/blog-update', () => {
  it(
    'should create a user and update that field on that user',
    () =>
      withBlogUpdate(async ({ db }) => {
        const email = 'alice@example.com';
        const name = 'Alice';
        const newEmail = 'alice-new@example.com';

        await db.public.User.create({ id: 'u1', email, name });

        const user = await db.public.User.first({ email });

        const response = await db.public.User.select('email').where({ id: user!.id }).update({
          email: newEmail,
        });

        expect(response?.email).toEqual(newEmail);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'should create a user and post and connect them together',
    () =>
      withBlogUpdate(async ({ db }) => {
        const email = 'bob@example.com';
        const name = 'Bob';
        const title = 'hello-world';
        const published = true;

        const user = await db.public.User.select('id', 'email', 'name').create({
          id: 'u2',
          email,
          name,
        });

        const post = await db.public.Post.select('id', 'title', 'published').create({
          id: 'p1',
          title,
          published,
        });

        const response = await db.public.User.select('id', 'name', 'email')
          .include('posts', (posts) => posts.select('id', 'title', 'published'))
          .where({ id: user.id })
          .update({
            posts: (posts) => posts.connect({ id: post.id }),
          });

        expect(response).toMatchObject({
          ...user,
          posts: [post],
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'should create a user and post and disconnect them',
    () =>
      withBlogUpdate(async ({ db }) => {
        const email = 'carol@example.com';
        const name = 'Carol';
        const title = 'my-post';
        const published = true;

        const user = await db.public.User.select('id', 'email', 'name')
          .include('posts', (posts) => posts.select('id', 'title', 'published'))
          .create({
            id: 'u3',
            email,
            name,
            posts: (posts) =>
              posts.create([
                {
                  id: 'p2',
                  title,
                  published,
                },
              ]),
          });

        const response = await db.public.User.select('id', 'name', 'email')
          .include('posts', (posts) => posts.select('id', 'title', 'published'))
          .where({ id: user.id })
          .update({
            posts: (posts) => posts.disconnect([{ id: user.posts[0]!.id }]),
          });

        expect(response).toMatchObject({
          ...user,
          posts: [],
        });
      }),
    timeouts.spinUpPpgDev,
  );
});
