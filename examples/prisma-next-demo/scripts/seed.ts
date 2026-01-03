import 'dotenv/config';
import type { ExecutionPlan } from '@prisma-next/contract/types';
import { param } from '@prisma-next/sql-relational-core/param';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { schema, sql } from '../src/prisma/query';
import { closeRuntime, getRuntime } from '../src/prisma/runtime';

/**
 * Collects all rows from a plan execution.
 */
async function collectRows<P extends ExecutionPlan | SqlQueryPlan<unknown>>(
  plan: P,
): Promise<ResultType<P>[]> {
  const runtime = getRuntime();
  const rows: ResultType<P>[] = [];
  for await (const row of runtime.execute(plan)) {
    rows.push(row as ResultType<P>);
  }
  return rows;
}

/**
 * Generates a sample embedding vector (1536 dimensions).
 */
function generateEmbedding(seed: number): number[] {
  const embedding: number[] = [];
  for (let i = 0; i < 1536; i++) {
    embedding.push(Math.sin(seed + i) * 0.1);
  }
  return embedding;
}

async function main() {
  const now = new Date();
  const tables = schema.tables;
  const userTable = tables.user;
  const postTable = tables.post;
  const userColumns = userTable.columns;
  const postColumns = postTable.columns;

  // Insert users
  const alicePlan = sql
    .insert(userTable, {
      email: param('email'),
      createdAt: param('createdAt'),
    })
    .returning(userColumns.id, userColumns.email)
    .build({
      params: {
        email: 'alice@example.com',
        createdAt: now,
      },
    });

  const alice = (await collectRows(alicePlan))[0];

  const bobPlan = sql
    .insert(userTable, {
      email: param('email'),
      createdAt: param('createdAt'),
    })
    .returning(userColumns.id, userColumns.email)
    .build({
      params: {
        email: 'bob@example.com',
        createdAt: now,
      },
    });

  const bob = (await collectRows(bobPlan))[0];

  if (!alice || !bob) {
    throw new Error('Failed to create users');
  }

  type UserRow = ResultType<typeof alicePlan>;
  const aliceUser = alice as UserRow;
  const bobUser = bob as UserRow;

  console.log(`Created user: ${aliceUser.email} (id: ${aliceUser.id})`);
  console.log(`Created user: ${bobUser.email} (id: ${bobUser.id})`);

  // Insert posts with embeddings
  const post1Plan = sql
    .insert(postTable, {
      title: param('title'),
      userId: param('userId'),
      createdAt: param('createdAt'),
      embedding: param('embedding'),
    })
    .returning(postColumns.id, postColumns.title, postColumns.userId)
    .build({
      params: {
        title: 'First Post',
        userId: alice.id,
        createdAt: now,
        embedding: generateEmbedding(1),
      },
    });

  const post1 = (await collectRows(post1Plan))[0];

  const post2Plan = sql
    .insert(postTable, {
      title: param('title'),
      userId: param('userId'),
      createdAt: param('createdAt'),
      embedding: param('embedding'),
    })
    .returning(postColumns.id, postColumns.title, postColumns.userId)
    .build({
      params: {
        title: 'Second Post',
        userId: alice.id,
        createdAt: now,
        embedding: generateEmbedding(2),
      },
    });

  const post2 = (await collectRows(post2Plan))[0];

  const post3Plan = sql
    .insert(postTable, {
      title: param('title'),
      userId: param('userId'),
      createdAt: param('createdAt'),
      embedding: param('embedding'),
    })
    .returning(postColumns.id, postColumns.title, postColumns.userId)
    .build({
      params: {
        title: 'Third Post',
        userId: bob.id,
        createdAt: now,
        embedding: generateEmbedding(3),
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
