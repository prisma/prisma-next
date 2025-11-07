import { param } from '@prisma-next/sql-query/param';
import type { Plan, ResultType } from '@prisma-next/contract/types';
import { schema, sql } from '../src/prisma/query';
import { getRuntime, closeRuntime } from '../src/prisma/runtime';

async function collectRows<T>(plan: Plan<T>): Promise<ResultType<T>[]> {
  const runtime = getRuntime();
  const rows: ResultType<T>[] = [];
  for await (const row of runtime.execute(plan)) {
    rows.push(row as ResultType<T>);
  }
  return rows;
}

async function main() {
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

  type AliceRow = ResultType<typeof alicePlan>;
  const alice = (await collectRows<AliceRow>(alicePlan))[0];

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

  type BobRow = ResultType<typeof bobPlan>;
  const bob = (await collectRows<BobRow>(bobPlan))[0];

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

  type PostRow = ResultType<typeof post1Plan>;
  const post1 = (await collectRows<PostRow>(post1Plan))[0];

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

  const post2 = (await collectRows<PostRow>(post2Plan))[0];

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

  const post3 = (await collectRows<PostRow>(post3Plan))[0];

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

