import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import pgvectorRuntime from '@prisma-next/extension-pgvector/runtime';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import type { AsyncIterableResult } from '@prisma-next/framework-components/runtime';
import type { SqlExecutionPlan, SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import {
  createExecutionContext,
  createRuntime,
  createSqlExecutionStack,
} from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import { Pool } from 'pg';
import type { RuntimeQueryable } from '../../src/types';
import { getTestContract, type TestContract } from '../helpers';

interface SeedUser {
  id: number;
  name: string;
  email: string;
  invitedById?: number | null;
}

interface SeedPost {
  id: number;
  title: string;
  userId: number | null;
  views: number;
  embedding?: number[] | null;
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
  readonly executions: readonly SqlExecutionPlan[];
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

  const contract = getTestContract();
  const adapter = createPostgresAdapter();

  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: [pgvectorRuntime],
  });

  const context = createExecutionContext<TestContract>({ contract, stack });
  const stackInstance = instantiateExecutionStack(stack);

  const driver = stackInstance.driver;
  if (!driver) {
    throw new Error('Driver descriptor missing from execution stack');
  }
  await driver.connect({ kind: 'pgPool', pool });

  const realRuntime = createRuntime({
    stackInstance,
    context,
    driver,
    verify: { mode: 'onFirstUse', requireMarker: false },
  });

  const executions: SqlExecutionPlan[] = [];

  const toLoweredPlan = <Row>(
    plan: SqlExecutionPlan<Row> | SqlQueryPlan<Row>,
  ): SqlExecutionPlan<Row> => {
    if ('sql' in plan) {
      return plan;
    }

    const lowered = adapter.lower(plan.ast, {
      contract,
      params: plan.params,
    });

    return {
      sql: lowered.sql,
      params: lowered.params ?? plan.params,
      ast: plan.ast,
      meta: plan.meta,
    };
  };

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
      await realRuntime.close();
    },
    execute<Row>(
      plan: (SqlExecutionPlan | SqlQueryPlan) & { readonly _row?: Row },
    ): AsyncIterableResult<Row> {
      executions.push(toLoweredPlan(plan));
      return realRuntime.execute(plan);
    },
  };

  return runtime;
}

export async function setupTestSchema(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('create schema if not exists prisma_contract');
  await runtime.query(`create table if not exists prisma_contract.marker (
    id smallint primary key default 1,
    core_hash text not null,
    profile_hash text not null,
    contract_json jsonb,
    canonical_version int,
    updated_at timestamptz not null default now(),
    app_tag text,
    meta jsonb not null default '{}'
  )`);
  await runtime.query('create extension if not exists vector');

  await runtime.query('drop table if exists tags');
  await runtime.query('drop table if exists comments');
  await runtime.query('drop table if exists profiles');
  await runtime.query('drop table if exists posts');
  await runtime.query('drop table if exists users');

  await runtime.query(`
    create table users (
      id integer primary key,
      name text not null,
      email text not null,
      invited_by_id integer,
      address jsonb
    )
  `);

  await runtime.query(`
    create table posts (
      id integer primary key,
      title text not null,
      user_id integer,
      views integer not null,
      embedding vector
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

  await runtime.query(`
    create table tags (
      id text primary key,
      name text not null unique
    )
  `);
}

export async function seedUsers(
  runtime: PgIntegrationRuntime,
  users: readonly SeedUser[],
): Promise<void> {
  for (const user of users) {
    await runtime.query(
      'insert into users (id, name, email, invited_by_id) values ($1, $2, $3, $4)',
      [user.id, user.name, user.email, user.invitedById ?? null],
    );
  }
}

export async function seedPosts(
  runtime: PgIntegrationRuntime,
  posts: readonly SeedPost[],
): Promise<void> {
  for (const post of posts) {
    await runtime.query(
      'insert into posts (id, title, user_id, views, embedding) values ($1, $2, $3, $4, $5)',
      [
        post.id,
        post.title,
        post.userId,
        post.views,
        post.embedding ? `[${post.embedding.join(',')}]` : null,
      ],
    );
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
