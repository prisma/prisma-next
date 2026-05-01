/**
 * Seeds the demo schema with users, posts, and tasks.
 *
 * Mirrors examples/prisma-next-demo/scripts/seed.ts minus the pgvector
 * embeddings (this example exercises the per-request facade, not vectors).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../src/prisma/db';

function loadDevVars(): Record<string, string> {
  const path = resolve(process.cwd(), '.dev.vars');
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    out[key] = raw.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return out;
}

async function main() {
  const devVars = loadDevVars();
  const url =
    devVars['LOCAL_DATABASE_URL'] ??
    process.env['LOCAL_DATABASE_URL'] ??
    process.env['DATABASE_URL'];

  if (!url) {
    throw new Error(
      'Set LOCAL_DATABASE_URL in .dev.vars (or DATABASE_URL) before running pnpm seed.',
    );
  }

  await using runtime = await db.connect({ url });

  await runtime.execute(
    db.sql.user
      .insert({
        email: 'alice@example.com',
        displayName: 'Alice',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
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
        createdAt: new Date('2026-04-02T00:00:00.000Z'),
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
  const bobRows = await runtime.execute(
    db.sql.user
      .select('id', 'email')
      .where((f, fns) => fns.eq(f.email, 'bob@example.com'))
      .limit(1)
      .build(),
  );
  const alice = aliceRows[0];
  const bob = bobRows[0];
  if (!alice || !bob) {
    throw new Error('Failed to find seeded users');
  }

  for (let i = 0; i < 5; i++) {
    await runtime.execute(
      db.sql.post
        .insert({
          title: `Alice post ${i + 1}`,
          userId: alice.id,
          createdAt: new Date(Date.UTC(2026, 3, 10 + i)),
        })
        .build(),
    );
  }

  for (let i = 0; i < 3; i++) {
    await runtime.execute(
      db.sql.post
        .insert({
          title: `Bob post ${i + 1}`,
          userId: bob.id,
          createdAt: new Date(Date.UTC(2026, 3, 20 + i)),
        })
        .build(),
    );
  }

  console.log(`Seeded users: alice=${alice.id}, bob=${bob.id}`);
  console.log('Seed complete (tasks/bugs/features intentionally empty — exercised by tests).');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});
