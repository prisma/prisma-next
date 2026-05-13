/**
 * End-to-end mixed-codec query against live Postgres + EQL bundle
 * + ZeroKMS.
 *
 * Pins the cross-codec invariants:
 *   - A single query that touches multiple cipherstash columns of
 *     different types in WHERE + ORDER BY succeeds end-to-end.
 *   - Bulk-encrypt batches every search-term envelope into the
 *     minimum number of SDK round-trips — one `bulkEncrypt` per
 *     `(table, column)` group (covered by the bulk-encrypt
 *     middleware unit tests in
 *     `packages/3-extensions/cipherstash/test/bulk-encrypt-middleware.test.ts`).
 *
 * The SDK round-trip count is observed by instrumenting the example
 * app's `createCipherstashSdk()` for the duration of the test.
 * Concretely:
 *
 *   - WHERE clause touches `email` (string) + `salary` (double) +
 *     `birthday` (date) + `emailVerified` (boolean) — four cipher
 *     columns, so **4 bulkEncrypt calls** for the search terms.
 *   - The query is a read so no row-write envelopes are encrypted.
 *   - The result rows carry encrypted values across six columns; a
 *     follow-up `decryptAll(rows)` produces **6 bulkDecrypt calls**
 *     (one per `(table, column)` group spanning the result set).
 */

import { bulkEncryptMiddleware } from '@prisma-next/extension-cipherstash/middleware';
import {
  cipherstashAsc,
  createCipherstashRuntimeDescriptor,
  decryptAll,
  EncryptedBigInt,
  EncryptedBoolean,
  EncryptedDate,
  EncryptedDouble,
  EncryptedJson,
  EncryptedString,
} from '@prisma-next/extension-cipherstash/runtime';
import postgres from '@prisma-next/postgres/runtime';
import { and } from '@prisma-next/sql-orm-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Contract } from '../../src/prisma/contract.d';
import contractJson from '../../src/prisma/contract.json' with { type: 'json' };
import { createCipherstashSdk } from '../../src/sdk';
import { truncateUsers } from './harness';

const SEED = [
  {
    id: 'e2e-mixed-0',
    email: 'alice@example.com',
    salary: 50_000,
    birthday: new Date('1985-01-01'),
    emailVerified: true,
  },
  {
    id: 'e2e-mixed-1',
    email: 'bob@example.com',
    salary: 110_000,
    birthday: new Date('1990-06-15'),
    emailVerified: true,
  },
  {
    id: 'e2e-mixed-2',
    email: 'carol@example.com',
    salary: 90_000,
    birthday: new Date('1980-03-22'),
    emailVerified: false,
  },
  {
    id: 'e2e-mixed-3',
    email: 'dave@otherorg.test',
    salary: 145_000,
    birthday: new Date('1978-11-30'),
    emailVerified: true,
  },
] as const;

function seedRow(s: (typeof SEED)[number]) {
  return {
    id: s.id,
    email: EncryptedString.from(s.email),
    salary: EncryptedDouble.from(s.salary),
    accountId: EncryptedBigInt.from(1_000_000n),
    birthday: EncryptedDate.from(s.birthday),
    emailVerified: EncryptedBoolean.from(s.emailVerified),
    preferences: EncryptedJson.from({ marker: 'mixed' }),
  };
}

/**
 * Build a counting wrapper around the example app's SDK so we can
 * observe `bulkEncrypt` / `bulkDecrypt` call counts independent of
 * the harness's shared `db` instance.
 */
function createCountingSdk() {
  const base = createCipherstashSdk();
  let bulkEncryptCalls = 0;
  let bulkDecryptCalls = 0;
  return {
    sdk: {
      ...base,
      async bulkEncrypt(args: Parameters<typeof base.bulkEncrypt>[0]) {
        bulkEncryptCalls += 1;
        return base.bulkEncrypt(args);
      },
      async bulkDecrypt(args: Parameters<typeof base.bulkDecrypt>[0]) {
        bulkDecryptCalls += 1;
        return base.bulkDecrypt(args);
      },
    },
    counts: {
      get bulkEncrypt() {
        return bulkEncryptCalls;
      },
      get bulkDecrypt() {
        return bulkDecryptCalls;
      },
      reset() {
        bulkEncryptCalls = 0;
        bulkDecryptCalls = 0;
      },
    },
  };
}

describe('Mixed-codec e2e (live PG + EQL + ZeroKMS)', () => {
  // Use a private `db` instance with a counting SDK so the round-trip
  // assertions are insulated from any other test file that may have
  // mutated the harness's shared client.
  const url =
    process.env['DATABASE_URL'] ??
    'postgres://cipherstash:cipherstash@localhost:54329/cipherstash_e2e';
  const counting = createCountingSdk();
  const db = postgres<Contract>({
    contractJson,
    extensions: [createCipherstashRuntimeDescriptor({ sdk: counting.sdk })],
    middleware: [bulkEncryptMiddleware(counting.sdk)],
  });
  let runtime: { close(): Promise<void> } | undefined;

  beforeAll(async () => {
    runtime = (await db.connect({ url })) as { close(): Promise<void> };
    truncateUsers();
    await Promise.all(SEED.map((s) => db.orm.User.create(seedRow(s))));
    counting.counts.reset();
  });

  afterAll(async () => {
    if (runtime) {
      await runtime.close();
    }
  });

  it('executes a four-column WHERE + ordered read end-to-end', async () => {
    const rows = await db.orm.User.where((u) =>
      and(
        u.email.cipherstashIlike('%@example.com'),
        u.salary.cipherstashGt(75_000),
        u.birthday.cipherstashLt(new Date('2000-01-01')),
        u.emailVerified.cipherstashInArray([true]),
      ),
    )
      .orderBy((u) => cipherstashAsc(u.salary))
      .all();

    // Only bob (e2e-mixed-1) survives all four predicates: alice's
    // salary is below the 75k cutoff, carol is unverified, and
    // dave's email `dave@otherorg.test` doesn't match `%@example.com`.
    expect(rows.map((r) => r.id)).toEqual(['e2e-mixed-1']);
  });

  it('groups search-term encrypts: one bulkEncrypt per (table, column)', async () => {
    counting.counts.reset();
    await db.orm.User.where((u) =>
      and(
        u.email.cipherstashIlike('%@example.com'),
        u.salary.cipherstashGt(75_000),
        u.birthday.cipherstashLt(new Date('2000-01-01')),
        u.emailVerified.cipherstashInArray([true]),
      ),
    )
      .orderBy((u) => cipherstashAsc(u.salary))
      .all();
    // Four distinct (users, <column>) groups in the WHERE — one
    // `bulkEncrypt` round-trip per group. ORDER BY is a column ref
    // (no envelope to encrypt). No row writes, so no additional
    // bulk-encrypt calls beyond the search-term batches.
    expect(counting.counts.bulkEncrypt).toBe(4);
  });

  it('groups result decrypts: one bulkDecrypt per (table, column)', async () => {
    counting.counts.reset();
    const rows = await db.orm.User.all();
    await decryptAll(rows);
    // Six encrypted columns × N rows ⇒ exactly 6 `bulkDecrypt` calls
    // (one per `(users, <column>)` group).
    expect(counting.counts.bulkDecrypt).toBe(6);
  });
});
