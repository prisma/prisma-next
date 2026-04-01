/**
 * Database Seed Script
 *
 * Populates the demo database with sample data using Prisma Next's SQL builder.
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

import { loadAppConfig } from '../src/app-config';
import { db } from '../src/prisma/db';
import { collect } from '../src/queries/utils';

async function main() {
  const { databaseUrl } = loadAppConfig();
  const runtime = await db.connect({ url: databaseUrl });
  const rt = db.runtime();

  try {
    // Insert users
    await collect(
      rt.execute(
        db.sql.user
          .insert({
            email: 'alice@example.com',
            createdAt: new Date(),
            kind: 'admin',
          })
          .build(),
      ),
    );

    await collect(
      rt.execute(
        db.sql.user
          .insert({
            email: 'bob@example.com',
            createdAt: new Date(),
            kind: 'user',
          })
          .build(),
      ),
    );

    const aliceRows = await collect(
      rt.execute(
        db.sql.user
          .select('id', 'email')
          .where((f, fns) => fns.eq(f.email, 'alice@example.com'))
          .limit(1)
          .build(),
      ),
    );
    const alice = aliceRows[0] ?? null;

    const bobRows = await collect(
      rt.execute(
        db.sql.user
          .select('id', 'email')
          .where((f, fns) => fns.eq(f.email, 'bob@example.com'))
          .limit(1)
          .build(),
      ),
    );
    const bob = bobRows[0] ?? null;

    if (!alice || !bob) {
      throw new Error('Failed to create users');
    }

    console.log(`Created user: ${alice.email} (id: ${alice.id})`);
    console.log(`Created user: ${bob.email} (id: ${bob.id})`);

    // Generate sample embedding vectors (1536 dimensions, matching common embedding models)
    const generateEmbedding = (seed: number): number[] => {
      const embedding: number[] = [];
      for (let i = 0; i < 1536; i++) {
        embedding.push(Math.sin(seed + i) * 0.1);
      }
      return embedding;
    };

    // Insert posts with embeddings
    await collect(
      rt.execute(
        db.sql.post
          .insert({
            title: 'First Post',
            userId: alice.id,
            embedding: generateEmbedding(1),
            createdAt: new Date(),
          })
          .build(),
      ),
    );

    await collect(
      rt.execute(
        db.sql.post
          .insert({
            title: 'Second Post',
            userId: alice.id,
            embedding: generateEmbedding(2),
            createdAt: new Date(),
          })
          .build(),
      ),
    );

    await collect(
      rt.execute(
        db.sql.post
          .insert({
            title: 'Third Post',
            userId: bob.id,
            embedding: generateEmbedding(3),
            createdAt: new Date(),
          })
          .build(),
      ),
    );

    console.log('Seed completed successfully!');
  } finally {
    await runtime.close();
  }
}

main().catch((e) => {
  console.error('Error seeding database:', e);
  process.exitCode = 1;
});
