/**
 * Seed the demo database with users, posts, and comments matching the
 * Pothos author's example schema. Re-running clears existing rows first.
 */
import 'dotenv/config';
import { db } from '../src/prisma/db';

const SQLITE_PATH = process.env['SQLITE_PATH'] ?? './pothos-demo.db';

async function main() {
  const runtime = await db.connect({ path: SQLITE_PATH });
  try {
    // Clear in dependency order.
    await runtime.execute(db.sql.comment.delete().build()).toArray();
    await runtime.execute(db.sql.post.delete().build()).toArray();
    await runtime.execute(db.sql.user.delete().build()).toArray();

    // Insert users.
    const aliceRows = await runtime
      .execute(
        db.sql.user
          .insert({
            firstName: 'Alice',
            lastName: 'Andrews',
            email: 'alice@example.com',
          })
          .returning('id', 'email')
          .build(),
      )
      .toArray();
    const bobRows = await runtime
      .execute(
        db.sql.user
          .insert({
            firstName: 'Bob',
            lastName: 'Brown',
            email: 'bob@example.com',
          })
          .returning('id', 'email')
          .build(),
      )
      .toArray();

    const aliceRow = aliceRows[0];
    const bobRow = bobRows[0];
    if (!aliceRow || !bobRow) throw new Error('Failed to insert users');
    const aliceId = aliceRow.id as string;
    const bobId = bobRow.id as string;

    // Insert posts. Mix of published / draft to demonstrate the
    // drafts/posts pattern in M2.
    const postsToInsert = [
      {
        title: 'Hello, Pothos',
        content: 'Welcome to the demo.',
        published: 1,
        authorId: aliceId,
        createdAt: new Date('2026-04-01T10:00:00Z'),
      },
      {
        title: 'Draft #1',
        content: 'WIP, not for prod.',
        published: 0,
        authorId: aliceId,
        createdAt: new Date('2026-04-02T10:00:00Z'),
      },
      {
        title: 'Bob writes about prisma-next',
        content: 'My experience moving to the new ORM.',
        published: 1,
        authorId: bobId,
        createdAt: new Date('2026-04-03T10:00:00Z'),
      },
      {
        title: "Bob's draft",
        content: 'Polishing this one.',
        published: 0,
        authorId: bobId,
        createdAt: new Date('2026-04-04T10:00:00Z'),
      },
    ];

    const insertedPosts: { id: string; title: string }[] = [];
    for (const p of postsToInsert) {
      const rows = await runtime
        .execute(db.sql.post.insert(p).returning('id', 'title').build())
        .toArray();
      const row = rows[0];
      if (!row) throw new Error('Failed to insert post');
      insertedPosts.push({ id: row.id as string, title: row.title as string });
    }

    const hello = insertedPosts.find((p) => p.title === 'Hello, Pothos');
    if (!hello) throw new Error('Hello post missing');
    const helloPostId = hello.id;

    // Insert comments on the published post.
    await runtime
      .execute(
        db.sql.comment
          .insert({ body: 'Looks great!', authorId: bobId, postId: helloPostId })
          .build(),
      )
      .toArray();
    await runtime
      .execute(
        db.sql.comment
          .insert({ body: 'Glad to see this working.', authorId: aliceId, postId: helloPostId })
          .build(),
      )
      .toArray();

    console.log(`Seed complete. users=2 posts=${insertedPosts.length} comments=2`);
  } finally {
    await runtime.close();
  }
}

await main();
