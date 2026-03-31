/**
 * Database Seed Script
 *
 * Populates the demo database with sample data using Prisma Next's SQL builder.
 *
 * Run with: pnpm seed
 */
import 'dotenv/config';

import { loadAppConfig } from '../src/app-config';
import { db } from '../src/prisma/db';

async function main() {
  const { databaseUrl } = loadAppConfig();
  const runtime = await db.connect({ url: databaseUrl });

  try {
    // Insert users
    await db.sql.user
      .insert({
        email: 'alice@example.com',
        createdAt: new Date(),
        kind: 'admin',
      })
      .first();

    await db.sql.user
      .insert({
        email: 'bob@example.com',
        createdAt: new Date(),
        kind: 'user',
      })
      .first();

    const alice = await db.sql.user
      .select('id', 'email')
      .where((f, fns) => fns.eq(f.email, 'alice@example.com'))
      .limit(1)
      .first();

    const bob = await db.sql.user
      .select('id', 'email')
      .where((f, fns) => fns.eq(f.email, 'bob@example.com'))
      .limit(1)
      .first();

    if (!alice || !bob) {
      throw new Error('Failed to create users');
    }

    console.log(`Created user: ${alice.email} (id: ${alice.id})`);
    console.log(`Created user: ${bob.email} (id: ${bob.id})`);

    // Generate sample embedding vectors (1536 dimensions)
    const generateEmbedding = (seed: number): number[] => {
      const embedding: number[] = [];
      for (let i = 0; i < 1536; i++) {
        embedding.push(Math.sin(seed + i) * 0.1);
      }
      return embedding;
    };

    // Insert posts with embeddings
    await db.sql.post
      .insert({
        title: 'First Post',
        userId: alice.id,
        embedding: generateEmbedding(1),
        createdAt: new Date(),
      })
      .first();

    await db.sql.post
      .insert({
        title: 'Second Post',
        userId: alice.id,
        embedding: generateEmbedding(2),
        createdAt: new Date(),
      })
      .first();

    await db.sql.post
      .insert({
        title: 'Third Post',
        userId: bob.id,
        embedding: generateEmbedding(3),
        createdAt: new Date(),
      })
      .first();

    console.log('Seed completed successfully!');
  } finally {
    await runtime.close();
  }
}

main().catch((e) => {
  console.error('Error seeding database:', e);
  process.exitCode = 1;
});
