import type { ExecutionPlan } from '@prisma-next/contract/types';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import { Pool } from 'pg';
import type { RuntimeQueryable } from '../../src/types';

interface SeedUser {
  id: number;
  name: string;
  email: string;
}

interface SeedPost {
  id: number;
  title: string;
  userId: number | null;
  views: number;
}

interface SeedProfile {
  id: number;
  userId: number | null;
  bio: string;
}

interface SeedComment {
  id: number;
  body: string;
  postId: number;
}

export interface PgIntegrationRuntime extends RuntimeQueryable {
  readonly executions: readonly ExecutionPlan[];
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sqlText: string,
    params?: readonly unknown[],
  ): Promise<readonly Row[]>;
  resetExecutions(): void;
  close(): Promise<void>;
}

export async function createPgIntegrationRuntime(
  connectionString: string,
): Promise<PgIntegrationRuntime> {
  const pool = new Pool({ connectionString });
  await pool.query('select 1');

  const executions: ExecutionPlan[] = [];

  const runtime: PgIntegrationRuntime = {
    executions,
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      sqlText: string,
      params: readonly unknown[] = [],
    ): Promise<readonly Row[]> {
      const result = await pool.query<Row>(sqlText, [...params]);
      return result.rows;
    },
    resetExecutions() {
      executions.length = 0;
    },
    async close() {
      await pool.end();
    },
    execute<Row>(plan: ExecutionPlan<Row>): AsyncIterableResult<Row> {
      executions.push(plan as ExecutionPlan);

      const runQuery = pool.query<Record<string, unknown>>(plan.sql, [...plan.params]);
      const generator = async function* (): AsyncGenerator<Row, void, unknown> {
        const result = await runQuery;
        for (const row of result.rows) {
          yield row as Row;
        }
      };

      return new AsyncIterableResult(generator());
    },
  };

  return runtime;
}

export async function setupTestSchema(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('drop table if exists comments');
  await runtime.query('drop table if exists profiles');
  await runtime.query('drop table if exists posts');
  await runtime.query('drop table if exists users');

  await runtime.query(`
    create table users (
      id integer primary key,
      name text not null,
      email text not null
    )
  `);

  await runtime.query(`
    create table posts (
      id integer primary key,
      title text not null,
      user_id integer,
      views integer not null
    )
  `);

  await runtime.query(`
    create table comments (
      id integer primary key,
      body text not null,
      post_id integer not null
    )
  `);

  await runtime.query(`
    create table profiles (
      id integer primary key,
      user_id integer,
      bio text not null
    )
  `);
}

export async function seedUsers(
  runtime: PgIntegrationRuntime,
  users: readonly SeedUser[],
): Promise<void> {
  for (const user of users) {
    await runtime.query('insert into users (id, name, email) values ($1, $2, $3)', [
      user.id,
      user.name,
      user.email,
    ]);
  }
}

export async function seedPosts(
  runtime: PgIntegrationRuntime,
  posts: readonly SeedPost[],
): Promise<void> {
  for (const post of posts) {
    await runtime.query('insert into posts (id, title, user_id, views) values ($1, $2, $3, $4)', [
      post.id,
      post.title,
      post.userId,
      post.views,
    ]);
  }
}

export async function seedProfiles(
  runtime: PgIntegrationRuntime,
  profiles: readonly SeedProfile[],
): Promise<void> {
  for (const profile of profiles) {
    await runtime.query('insert into profiles (id, user_id, bio) values ($1, $2, $3)', [
      profile.id,
      profile.userId,
      profile.bio,
    ]);
  }
}

export async function seedComments(
  runtime: PgIntegrationRuntime,
  comments: readonly SeedComment[],
): Promise<void> {
  for (const comment of comments) {
    await runtime.query('insert into comments (id, body, post_id) values ($1, $2, $3)', [
      comment.id,
      comment.body,
      comment.postId,
    ]);
  }
}
