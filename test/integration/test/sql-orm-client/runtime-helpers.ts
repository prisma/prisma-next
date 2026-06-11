import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import type { Contract } from '@prisma-next/contract/types';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import pgvectorRuntime from '@prisma-next/extension-pgvector/runtime';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import type { AsyncIterableResult } from '@prisma-next/framework-components/runtime';
import { PostgresRuntimeImpl } from '@prisma-next/postgres/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { RuntimeQueryable } from '@prisma-next/sql-orm-client';
import type { SqlExecutionPlan, SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import { Pool } from 'pg';
import { getTestContract } from './helpers';

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

interface SeedTag {
  id: string;
  name: string;
}

interface SeedUserTag {
  userId: number;
  tagId: string;
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
  // The runtime validates each plan's storageHash against this contract, so
  // tests driving a non-base fixture (e.g. the emitted polymorphism contract)
  // must build the runtime against that same contract. Defaults to the base
  // sql-orm-client fixture.
  contractOverride?: Contract<SqlStorage>,
): Promise<PgIntegrationRuntime> {
  const pool = new Pool({ connectionString });
  // Wrap stack/runtime construction so any failure between pool creation and
  // a working runtime releases the pool back to PG. Without this, an early
  // throw (e.g. missing adapter/driver descriptor) leaks the pool's
  // connections until the test process exits.
  const setup = await (async () => {
    try {
      await pool.query('select 1');

      const contract = contractOverride ?? getTestContract();

      const stack = createSqlExecutionStack({
        target: postgresTarget,
        adapter: postgresAdapter,
        driver: postgresDriver,
        extensionPacks: [pgvectorRuntime],
      });

      const context = createExecutionContext<Contract<SqlStorage>>({ contract, stack });
      const stackInstance = instantiateExecutionStack(stack);
      // Use the stack-composed adapter (carries `pg/vector@1` via the pgvector
      // extension pack) for both lowering-for-assertion and execution. A bare
      // `createPostgresAdapter()` here would fail at lower-time on any vector
      // ParamRef because the renderer now throws when a codecId is absent
      // from the assembled lookup (see ADR 205).
      const adapter = stackInstance.adapter;
      if (!adapter) {
        throw new Error('Adapter descriptor missing from execution stack');
      }

      const driver = stackInstance.driver;
      if (!driver) {
        throw new Error('Driver descriptor missing from execution stack');
      }
      await driver.connect({ kind: 'pgPool', pool });

      const realRuntime = new PostgresRuntimeImpl({
        context,
        adapter: stackInstance.adapter,
        driver,
      });
      return { adapter, realRuntime, contract };
    } catch (err) {
      await pool.end();
      throw err;
    }
  })();
  const { adapter, realRuntime, contract } = setup;

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
    space text not null primary key default 'app',
    core_hash text not null,
    profile_hash text not null,
    contract_json jsonb,
    canonical_version int,
    updated_at timestamptz not null default now(),
    app_tag text,
    meta jsonb not null default '{}',
    invariants text[] not null default '{}'
  )`);
  await runtime.query('create extension if not exists vector');

  await runtime.query('drop table if exists user_tags');
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

  await runtime.query(`
    create table user_tags (
      user_id integer not null,
      tag_id text not null,
      note text,
      created_at text not null default now(),
      primary key (user_id, tag_id)
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

export async function seedTags(
  runtime: PgIntegrationRuntime,
  tags: readonly SeedTag[],
): Promise<void> {
  for (const tag of tags) {
    await runtime.query('insert into tags (id, name) values ($1, $2)', [tag.id, tag.name]);
  }
}

export async function seedUserTags(
  runtime: PgIntegrationRuntime,
  userTags: readonly SeedUserTag[],
): Promise<void> {
  for (const ut of userTags) {
    await runtime.query('insert into user_tags (user_id, tag_id) values ($1, $2)', [
      ut.userId,
      ut.tagId,
    ]);
  }
}
