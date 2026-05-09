/**
 * Cipherstash integration example — end-to-end demo.
 *
 * Shows the full umbrella round-trip a real application performs:
 *
 *   1. Insert four `User` rows with `EncryptedString` envelopes
 *      wrapping the plaintext emails. The bulk-encrypt middleware
 *      groups them into a single `bulkEncrypt` SDK round-trip per
 *      `(table, column)` and stamps ciphertext onto each envelope
 *      before the `INSERT` runs.
 *
 *   2. `cipherstashEq('alice@example.com')` — exact-match search via
 *      the EQL `eql_v2.eq` operator on the column's deterministic
 *      `unique` index. The user-supplied plaintext is encrypted as a
 *      search term in the same bulk-encrypt phase as the row payloads.
 *
 *   3. `cipherstashIlike('%@example.com')` — bloom-filter free-text
 *      search via `eql_v2.ilike` on the column's `match` index.
 *
 *   4. `decryptAll(rows)` — bulk-decrypt the envelopes returned by the
 *      ILIKE search. One `bulkDecrypt` round-trip covers every row in
 *      the result set; subsequent `envelope.decrypt()` calls return
 *      cached plaintext synchronously.
 *
 * Prerequisites for actually running this demo:
 *
 *   - A Postgres database with the EQL bundle installed. Set
 *     `DATABASE_URL` (e.g. via `.env`) before invoking `pnpm start`.
 *   - The migrations under `migrations/` applied
 *     (`pnpm migration:apply`). The cipherstash extension contributes
 *     its own contract space at `migrations/cipherstash/` which
 *     installs the EQL composite types, configuration table, and
 *     bundle SQL alongside the application schema.
 *   - A real CipherStash-backed `CipherstashSdk` implementation. The
 *     `src/sdk.ts` shipped here is a **demo stub** — it tags
 *     plaintexts with a `ct:` prefix instead of encrypting them. Swap
 *     it for a real client before any non-toy use.
 */

import 'dotenv/config';

import { decryptAll, EncryptedString } from '@prisma-next/extension-cipherstash/runtime';
import { db } from './db';

const PLAINTEXTS = [
  'alice@example.com',
  'bob@example.com',
  'carol@example.com',
  'dave@otherorg.test',
] as const;

async function main() {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.error('Set DATABASE_URL in your environment (e.g. .env) before running this demo.');
    process.exit(1);
  }

  const runtime = await db.connect({ url });
  try {
    await insertUsers();
    await searchByEq();
    await searchByIlikeAndDecrypt();
  } finally {
    await runtime.close();
  }
}

async function insertUsers(): Promise<void> {
  console.log('--- Insert ---');
  await Promise.all(
    PLAINTEXTS.map((plaintext, i) =>
      db.orm.User.create({
        id: `user-${i}`,
        email: EncryptedString.from(plaintext),
      }),
    ),
  );
  console.log(`Inserted ${PLAINTEXTS.length} rows.`);
}

async function searchByEq(): Promise<void> {
  console.log('\n--- cipherstashEq ---');
  const rows = await db.orm.User.where((u) => u.email.cipherstashEq('alice@example.com')).all();
  console.log(`Found ${rows.length} row(s) for alice@example.com.`);
  await decryptAll(rows);
  for (const row of rows) {
    console.log(`  ${row.id}: ${await row.email.decrypt()}`);
  }
}

async function searchByIlikeAndDecrypt(): Promise<void> {
  console.log('\n--- cipherstashIlike + decryptAll ---');
  const rows = await db.orm.User.where((u) => u.email.cipherstashIlike('%@example.com')).all();
  console.log(`Found ${rows.length} row(s) matching %@example.com.`);
  await decryptAll(rows);
  for (const row of rows) {
    console.log(`  ${row.id}: ${await row.email.decrypt()}`);
  }
}

await main();
