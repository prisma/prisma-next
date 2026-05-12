/**
 * Cipherstash integration example — end-to-end demo.
 *
 * Exercises every cipherstash codec id the extension ships, plus
 * the trait-dispatched predicate operators, the sort helpers, and
 * the JSON SELECT-expression helpers, against a real Postgres + EQL
 * database.
 *
 * The bulk-encrypt middleware groups every plaintext placeholder
 * (row payloads + search terms) into a single `bulkEncrypt` SDK
 * round-trip per query and stamps ciphertext onto each envelope
 * before the `INSERT` / `SELECT` runs; `decryptAll(rows)` rounds
 * out the read path with one matching `bulkDecrypt` call covering
 * every envelope on every column of the result set.
 *
 * Prerequisites for actually running this demo:
 *
 *   - A Postgres database with the EQL bundle installed. Set
 *     `DATABASE_URL` (e.g. via `.env`) before invoking `pnpm start`.
 *   - The migrations under `migrations/` applied
 *     (`pnpm db:init` / `pnpm db:update`). The cipherstash extension
 *     contributes its own contract space at `migrations/cipherstash/`
 *     which installs the EQL composite types, configuration table,
 *     and bundle SQL alongside the application schema.
 *   - A CipherStash workspace + ZeroKMS credentials. Populate
 *     `CS_WORKSPACE_CRN`, `CS_CLIENT_ID`, `CS_CLIENT_KEY`, and
 *     `CS_CLIENT_ACCESS_KEY` in `.env` (see `.env.example`) — the
 *     SDK wrapper in `src/sdk.ts` wires `@cipherstash/stack` directly.
 */

import 'dotenv/config';

import {
  cipherstashAsc,
  decryptAll,
  EncryptedBigInt,
  EncryptedBoolean,
  EncryptedDate,
  EncryptedDouble,
  EncryptedJson,
  EncryptedString,
} from '@prisma-next/extension-cipherstash/runtime';
import { db } from './db';

interface UserSeed {
  readonly id: string;
  readonly email: string;
  readonly salary: number;
  readonly accountId: bigint;
  readonly birthday: Date;
  readonly emailVerified: boolean;
  readonly preferences: { readonly theme: string; readonly notifications: boolean };
}

const SEED_USERS: readonly UserSeed[] = [
  {
    id: 'user-0',
    email: 'alice@example.com',
    salary: 95_000,
    accountId: 100_000_000_001n,
    birthday: new Date('1990-04-12'),
    emailVerified: true,
    preferences: { theme: 'dark', notifications: true },
  },
  {
    id: 'user-1',
    email: 'bob@example.com',
    salary: 110_000,
    accountId: 100_000_000_002n,
    birthday: new Date('1985-09-23'),
    emailVerified: true,
    preferences: { theme: 'light', notifications: false },
  },
  {
    id: 'user-2',
    email: 'carol@example.com',
    salary: 75_000,
    accountId: 100_000_000_003n,
    birthday: new Date('1995-01-07'),
    emailVerified: false,
    preferences: { theme: 'dark', notifications: true },
  },
  {
    id: 'user-3',
    email: 'dave@otherorg.test',
    salary: 145_000,
    accountId: 100_000_000_004n,
    birthday: new Date('1978-11-30'),
    emailVerified: true,
    preferences: { theme: 'light', notifications: true },
  },
];

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
    await rangeQueryOnSalary();
    await betweenQueryOnBirthday();
    await inArrayQueryOnAccountId();
    await equalityQueryOnEmailVerified();
    await jsonbPathExistsOnPreferences();
    await sortByEmailAsc();
  } finally {
    await runtime.close();
  }
}

async function insertUsers(): Promise<void> {
  console.log('--- Insert (mixed-codec round-trip) ---');
  await Promise.all(
    SEED_USERS.map((seed) =>
      db.orm.User.create({
        id: seed.id,
        email: EncryptedString.from(seed.email),
        salary: EncryptedDouble.from(seed.salary),
        accountId: EncryptedBigInt.from(seed.accountId),
        birthday: EncryptedDate.from(seed.birthday),
        emailVerified: EncryptedBoolean.from(seed.emailVerified),
        preferences: EncryptedJson.from(seed.preferences),
      }),
    ),
  );
  console.log(`Inserted ${SEED_USERS.length} rows across six cipherstash codecs.`);
}

async function searchByEq(): Promise<void> {
  console.log('\n--- cipherstashEq (string) ---');
  const rows = await db.orm.User.where((u) => u.email.cipherstashEq('alice@example.com')).all();
  console.log(`Found ${rows.length} row(s) for alice@example.com.`);
  await decryptAll(rows);
  for (const row of rows) {
    console.log(`  ${row.id}: ${await row.email.decrypt()}`);
  }
}

async function searchByIlikeAndDecrypt(): Promise<void> {
  console.log('\n--- cipherstashIlike (string free-text-search) ---');
  const rows = await db.orm.User.where((u) => u.email.cipherstashIlike('%@example.com')).all();
  console.log(`Found ${rows.length} row(s) matching %@example.com.`);
  await decryptAll(rows);
  for (const row of rows) {
    console.log(`  ${row.id}: ${await row.email.decrypt()}`);
  }
}

async function rangeQueryOnSalary(): Promise<void> {
  console.log('\n--- cipherstashGt (double order-and-range) ---');
  const rows = await db.orm.User.where((u) => u.salary.cipherstashGt(100_000)).all();
  console.log(`Found ${rows.length} user(s) with salary > 100_000.`);
  await decryptAll(rows);
  for (const row of rows) {
    console.log(`  ${row.id}: salary=${await row.salary.decrypt()}`);
  }
}

async function betweenQueryOnBirthday(): Promise<void> {
  console.log('\n--- cipherstashBetween (date order-and-range) ---');
  const lower = new Date('1985-01-01');
  const upper = new Date('1995-12-31');
  const rows = await db.orm.User.where((u) => u.birthday.cipherstashBetween(lower, upper)).all();
  console.log(`Found ${rows.length} user(s) born between 1985 and 1995.`);
}

async function inArrayQueryOnAccountId(): Promise<void> {
  console.log('\n--- cipherstashInArray (bigint equality) ---');
  const rows = await db.orm.User.where((u) =>
    u.accountId.cipherstashInArray([100_000_000_001n, 100_000_000_004n]),
  ).all();
  console.log(`Found ${rows.length} user(s) whose accountId is in the supplied array.`);
}

async function equalityQueryOnEmailVerified(): Promise<void> {
  console.log('\n--- cipherstashInArray (boolean equality-only) ---');
  // Booleans surface only the equality-trait operators; the legacy
  // single-codec `cipherstashEq` is pinned to `cipherstash/string@1`,
  // so equality on non-string columns goes through the trait-dispatched
  // `cipherstashInArray` (a single-element array is the canonical
  // equality form).
  const rows = await db.orm.User.where((u) => u.emailVerified.cipherstashInArray([true])).all();
  console.log(`Found ${rows.length} user(s) with emailVerified in [true].`);
}

async function jsonbPathExistsOnPreferences(): Promise<void> {
  console.log('\n--- cipherstashJsonbPathExists (json searchable-json) ---');
  const rows = await db.orm.User.where((u) =>
    u.preferences.cipherstashJsonbPathExists('$.theme'),
  ).all();
  console.log(`Found ${rows.length} user(s) whose preferences contain a $.theme key.`);
}

// `cipherstashJsonbPathQueryFirst` / `cipherstashJsonbGet` are
// SELECT-expression-only helpers — they build an `OperationExpr`
// that lowers to `eql_v2.jsonb_path_query_first({{col}}, {{path}})`
// / `eql_v2."->"({{col}}, {{path}})`. The cipherstash extension's
// `helpers.test.ts` covers the AST + SQL snapshots for both; the
// `db.sql.users.select(...)` surface composing them into projections
// is exercised by the parity / e2e harness rather than the orm
// `where` callback used here for the predicate-operator demo.

async function sortByEmailAsc(): Promise<void> {
  console.log('\n--- cipherstashAsc (string order-and-range, bare-column ORDER BY) ---');
  const rows = await db.orm.User.orderBy((u) => cipherstashAsc(u.email)).all();
  await decryptAll(rows);
  for (const row of rows) {
    console.log(`  ${row.id}: email=${await row.email.decrypt()}`);
  }
}

await main();
