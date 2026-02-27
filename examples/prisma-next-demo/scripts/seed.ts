/**
 * Database Seed Script
 *
 * Populates the demo database with sample data using Prisma Next's SQL DSL.
 * Demonstrates INSERT with RETURNING clause and parameterized queries.
 *
 * Run with: pnpm seed
 *
 * Creates:
 * - 2 users (alice, bob)
 * - 3 posts with vector embeddings (for similarity search demos)
 *
 * Prerequisites:
 * - DATABASE_URL environment variable set
 * - Database schema and marker applied (run `pnpm emit` then `pnpm db:init`)
 */
import 'dotenv/config';

import { param } from '@prisma-next/sql-relational-core/param';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { loadAppConfig } from '../src/app-config';
import { db } from '../src/prisma/db';

async function main() {
  const { databaseUrl } = loadAppConfig();
  const runtime = db.connect({ url: databaseUrl });

  try {
    const tables = db.schema.tables;
    const userTable = tables.user;
    const postTable = tables.post;
    const userColumns = userTable.columns;
    const postColumns = postTable.columns;

    // Insert users
    const alicePlan = db.sql
      .insert(userTable, {
        email: param('email'),
        createdAt: param('createdAt'),
        kind: param('kind'),
      })
      .returning(userColumns.id, userColumns.email)
      .build({
        params: {
          email: 'alice@example.com',
          createdAt: new Date(),
          kind: 'admin',
        },
      });

    const alice = (await runtime.execute(alicePlan).toArray())[0];

    const bobPlan = db.sql
      .insert(userTable, {
        email: param('email'),
        createdAt: param('createdAt'),
        kind: param('kind'),
      })
      .returning(userColumns.id, userColumns.email)
      .build({
        params: {
          email: 'bob@example.com',
          createdAt: new Date(),
          kind: 'user',
        },
      });

    const bob = (await runtime.execute(bobPlan).toArray())[0];

    if (!alice || !bob) {
      throw new Error('Failed to create users');
    }

    type UserRow = ResultType<typeof alicePlan>;
    const aliceUser = alice as UserRow;
    const bobUser = bob as UserRow;

    console.log(`Created user: ${aliceUser.email} (id: ${aliceUser.id})`);
    console.log(`Created user: ${bobUser.email} (id: ${bobUser.id})`);

    // Generate sample embedding vectors (1536 dimensions, matching common embedding models)
    const generateEmbedding = (seed: number): number[] => {
      const embedding: number[] = [];
      for (let i = 0; i < 1536; i++) {
        embedding.push(Math.sin(seed + i) * 0.1);
      }
      return embedding;
    };

    // Insert posts with embeddings
    const post1Plan = db.sql
      .insert(postTable, {
        title: param('title'),
        userId: param('userId'),
        embedding: param('embedding'),
        createdAt: param('createdAt'),
      })
      .returning(postColumns.id, postColumns.title, postColumns.userId)
      .build({
        params: {
          title: 'First Post',
          userId: alice.id,
          embedding: generateEmbedding(1),
          createdAt: new Date(),
        },
      });

    const post1 = (await runtime.execute(post1Plan).toArray())[0];

    const post2Plan = db.sql
      .insert(postTable, {
        title: param('title'),
        userId: param('userId'),
        embedding: param('embedding'),
        createdAt: param('createdAt'),
      })
      .returning(postColumns.id, postColumns.title, postColumns.userId)
      .build({
        params: {
          title: 'Second Post',
          userId: alice.id,
          embedding: generateEmbedding(2),
          createdAt: new Date(),
        },
      });

    const post2 = (await runtime.execute(post2Plan).toArray())[0];

    const post3Plan = db.sql
      .insert(postTable, {
        title: param('title'),
        userId: param('userId'),
        embedding: param('embedding'),
        createdAt: param('createdAt'),
      })
      .returning(postColumns.id, postColumns.title, postColumns.userId)
      .build({
        params: {
          title: 'Third Post',
          userId: bob.id,
          embedding: generateEmbedding(3),
          createdAt: new Date(),
        },
      });

    const post3 = (await runtime.execute(post3Plan).toArray())[0];

    if (post1)
      console.log(`Created post: ${post1.title} (id: ${post1.id}, userId: ${post1.userId})`);
    if (post2)
      console.log(`Created post: ${post2.title} (id: ${post2.id}, userId: ${post2.userId})`);
    if (post3)
      console.log(`Created post: ${post3.title} (id: ${post3.id}, userId: ${post3.userId})`);

    console.log('Seed completed successfully!');
  } finally {
    await runtime.close();
  }
}

main().catch((e) => {
  console.error('Error seeding database:', e);
  process.exitCode = 1;
});
