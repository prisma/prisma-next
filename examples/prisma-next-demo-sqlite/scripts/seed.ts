/**
 * Database Seed Script
 *
 * Populates the demo database with sample data using Prisma Next's SQL builder.
 *
 * Run with: pnpm seed
 *
 * Creates:
 * - 2 users (alice, bob)
 * - 3 posts
 *
 * Prerequisites:
 * - SQLITE_PATH env var (defaults to ./demo.db)
 * - Database schema applied (run `pnpm emit` then `pnpm db:init`)
 */
import 'dotenv/config';

import { loadAppConfig } from '../src/app-config';
import { db } from '../src/prisma/db';

async function main() {
  const { databasePath } = loadAppConfig();
  const runtime = await db.connect({ path: databasePath });

  try {
    await runtime.execute(
      db.sql.user
        .insert({
          email: 'alice@example.com',
          displayName: 'Alice',
          createdAt: new Date(),
          kind: 'admin',
          address: { street: '123 Main St', city: 'San Francisco', zip: '94102', country: 'US' },
        })
        .build(),
    );

    await runtime.execute(
      db.sql.user
        .insert({
          email: 'bob@example.com',
          displayName: 'Bob',
          createdAt: new Date(),
          kind: 'user',
          address: { street: '456 Oak Ave', city: 'Portland', zip: null, country: 'US' },
        })
        .build(),
    );

    const aliceRows = await runtime.execute(
      db.sql.user
        .select('id', 'email')
        .where((f, fns) => fns.eq(f.email, 'alice@example.com'))
        .limit(1)
        .build(),
    );
    const alice = aliceRows[0] ?? null;

    const bobRows = await runtime.execute(
      db.sql.user
        .select('id', 'email')
        .where((f, fns) => fns.eq(f.email, 'bob@example.com'))
        .limit(1)
        .build(),
    );
    const bob = bobRows[0] ?? null;

    if (!alice || !bob) {
      throw new Error('Failed to create users');
    }

    console.log(`Created user: ${alice.email} (id: ${alice.id})`);
    console.log(`Created user: ${bob.email} (id: ${bob.id})`);

    await runtime.execute(
      db.sql.post
        .insert({
          title: 'First Post',
          userId: alice.id,
          createdAt: new Date(),
        })
        .build(),
    );

    await runtime.execute(
      db.sql.post
        .insert({
          title: 'Second Post',
          userId: alice.id,
          createdAt: new Date(),
        })
        .build(),
    );

    await runtime.execute(
      db.sql.post
        .insert({
          title: 'Third Post',
          userId: bob.id,
          createdAt: new Date(),
        })
        .build(),
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
