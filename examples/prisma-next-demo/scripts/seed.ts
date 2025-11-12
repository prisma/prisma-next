import 'dotenv/config';
import type { Plan, ResultType } from '@prisma-next/contract/types';
import { param } from '@prisma-next/sql-relational-core/param';
import { Client } from 'pg';
import { schema, sql } from '../src/prisma/query';
import { closeRuntime, getRuntime } from '../src/prisma/runtime';

async function collectRows<P extends Plan>(plan: P): Promise<ResultType<P>[]> {
  const runtime = getRuntime();
  const rows: ResultType<P>[] = [];
  for await (const row of runtime.execute(plan)) {
    rows.push(row as ResultType<P>);
  }
  return rows;
}

async function setupTables() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    // Create user table
    await client.query(`
      create table if not exists "user" (
        id serial primary key,
        email text not null unique,
        "createdAt" timestamptz not null default now()
      )
    `);

    // Create post table
    await client.query(`
      create table if not exists "post" (
        id serial primary key,
        title text not null,
        "userId" int4 not null,
        "createdAt" timestamptz not null default now(),
        constraint post_userId_fkey foreign key ("userId") references "user"(id)
      )
    `);

    // Clear existing data
    await client.query('truncate table "post", "user" restart identity cascade');
  } finally {
    await client.end();
  }
}

async function main() {
  // Setup tables first
  await setupTables();
  const tables = schema.tables;
  const userTable = tables.user;
  const postTable = tables.post;
  const userColumns = userTable.columns;
  const postColumns = postTable.columns;

  // Insert users
  const alicePlan = sql
    .insert(userTable, {
      email: param('email'),
    })
    .returning(userColumns.id, userColumns.email)
    .build({
      params: {
        email: 'alice@example.com',
      },
    });

  const alice = (await collectRows(alicePlan))[0];

  const bobPlan = sql
    .insert(userTable, {
      email: param('email'),
    })
    .returning(userColumns.id, userColumns.email)
    .build({
      params: {
        email: 'bob@example.com',
      },
    });

  const bob = (await collectRows(bobPlan))[0];

  if (!alice || !bob) {
    throw new Error('Failed to create users');
  }

  console.log(`Created user: ${alice.email} (id: ${alice.id})`);
  console.log(`Created user: ${bob.email} (id: ${bob.id})`);

  // Insert posts
  const post1Plan = sql
    .insert(postTable, {
      title: param('title'),
      userId: param('userId'),
    })
    .returning(postColumns.id, postColumns.title, postColumns.userId)
    .build({
      params: {
        title: 'First Post',
        userId: alice.id,
      },
    });

  const post1 = (await collectRows(post1Plan))[0];

  const post2Plan = sql
    .insert(postTable, {
      title: param('title'),
      userId: param('userId'),
    })
    .returning(postColumns.id, postColumns.title, postColumns.userId)
    .build({
      params: {
        title: 'Second Post',
        userId: alice.id,
      },
    });

  const post2 = (await collectRows(post2Plan))[0];

  const post3Plan = sql
    .insert(postTable, {
      title: param('title'),
      userId: param('userId'),
    })
    .returning(postColumns.id, postColumns.title, postColumns.userId)
    .build({
      params: {
        title: 'Third Post',
        userId: bob.id,
      },
    });

  const post3 = (await collectRows(post3Plan))[0];

  if (post1) console.log(`Created post: ${post1.title} (id: ${post1.id}, userId: ${post1.userId})`);
  if (post2) console.log(`Created post: ${post2.title} (id: ${post2.id}, userId: ${post2.userId})`);
  if (post3) console.log(`Created post: ${post3.title} (id: ${post3.id}, userId: ${post3.userId})`);

  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await closeRuntime();
  });
