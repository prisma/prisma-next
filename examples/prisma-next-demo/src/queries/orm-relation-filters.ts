import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { demoSchema, demoSql } from '../prisma/context';
import { collect } from './utils';

interface UserWithPosts {
  id: unknown;
  email: unknown;
  createdAt: unknown;
  posts: unknown[];
}

export async function ormGetUsersWithPosts(runtime: Runtime) {
  const userTable = demoSchema.tables.user;
  const postTable = demoSchema.tables.post;

  const plan = demoSql
    .from(userTable)
    .includeMany(
      postTable,
      (on) => on.eqCol(userTable.columns.id, postTable.columns.userId),
      (child) =>
        child.where(postTable.columns.id.eq(param('postId'))).select({
          id: postTable.columns.id,
        }),
      { alias: 'posts' },
    )
    .select({
      id: userTable.columns.id,
      email: userTable.columns.email,
      createdAt: userTable.columns.createdAt,
      posts: true,
    })
    .limit(100)
    .build({
      params: { postId: 'post_001' },
    });

  const users = (await collect(runtime.execute(plan))) as UserWithPosts[];
  return users.filter((user) => user.posts.length > 0).map(stripPostsField);
}

export async function ormGetUsersWithoutPosts(runtime: Runtime) {
  const userTable = demoSchema.tables.user;
  const postTable = demoSchema.tables.post;

  const plan = demoSql
    .from(userTable)
    .includeMany(
      postTable,
      (on) => on.eqCol(userTable.columns.id, postTable.columns.userId),
      (child) =>
        child.where(postTable.columns.id.eq(param('postId'))).select({
          id: postTable.columns.id,
        }),
      { alias: 'posts' },
    )
    .select({
      id: userTable.columns.id,
      email: userTable.columns.email,
      createdAt: userTable.columns.createdAt,
      posts: true,
    })
    .limit(100)
    .build({
      params: { postId: 'post_001' },
    });

  const users = (await collect(runtime.execute(plan))) as UserWithPosts[];
  return users.filter((user) => user.posts.length === 0).map(stripPostsField);
}

export async function ormGetUsersWhereAllPostsMatch(runtime: Runtime) {
  const userTable = demoSchema.tables.user;
  const postTable = demoSchema.tables.post;

  const plan = demoSql
    .from(userTable)
    .includeMany(
      postTable,
      (on) => on.eqCol(userTable.columns.id, postTable.columns.userId),
      (child) =>
        child.where(postTable.columns.userId.neq(param('userId'))).select({
          id: postTable.columns.id,
        }),
      { alias: 'posts' },
    )
    .select({
      id: userTable.columns.id,
      email: userTable.columns.email,
      createdAt: userTable.columns.createdAt,
      posts: true,
    })
    .limit(100)
    .build({
      params: { userId: 'user_001' },
    });

  const users = (await collect(runtime.execute(plan))) as UserWithPosts[];
  return users.filter((user) => user.posts.length === 0).map(stripPostsField);
}

function stripPostsField(user: UserWithPosts): Record<string, unknown> {
  const { posts: _posts, ...rest } = user;
  return rest;
}
