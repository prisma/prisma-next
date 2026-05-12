/**
 * AC-E2E-STR-RANGE — End-to-end round-trip for `EncryptedString`
 * authored with `orderAndRange: true` against live Postgres + EQL
 * bundle + ZeroKMS.
 *
 * The example schema authors `email` with the default no-args
 * constructor (`cipherstash.EncryptedString()`), which opts every
 * flag (`equality`, `freeTextSearch`, `orderAndRange`) into `true`.
 * Pins:
 *   - `cipherstashGt('m')` filters lexicographically.
 *   - `cipherstashAsc(u.email)` orders alphabetically.
 *   - `cipherstashIlike('%@example.com')` still works alongside the
 *     range queries (free-text-search trait coexists with
 *     order-and-range on the same column).
 */

import {
  cipherstashAsc,
  cipherstashDesc,
  decryptAll,
  EncryptedBigInt,
  EncryptedBoolean,
  EncryptedDate,
  EncryptedDouble,
  EncryptedJson,
  EncryptedString,
} from '@prisma-next/extension-cipherstash/runtime';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureConnected, truncateUsers } from './harness';

const SEED = [
  { id: 'e2e-str-0', email: 'alice@example.com' },
  { id: 'e2e-str-1', email: 'bob@example.com' },
  { id: 'e2e-str-2', email: 'mallory@example.com' },
  { id: 'e2e-str-3', email: 'zoe@other.test' },
] as const;

function seedRow(s: (typeof SEED)[number]) {
  return {
    id: s.id,
    email: EncryptedString.from(s.email),
    salary: EncryptedDouble.from(50_000),
    accountId: EncryptedBigInt.from(1_000_000n),
    birthday: EncryptedDate.from(new Date('1990-01-01')),
    emailVerified: EncryptedBoolean.from(true),
    preferences: EncryptedJson.from({ marker: 'str-range' }),
  };
}

describe('AC-E2E-STR-RANGE (live PG + EQL + ZeroKMS)', () => {
  beforeAll(async () => {
    await ensureConnected();
    truncateUsers();
    await Promise.all(SEED.map((s) => db.orm.User.create(seedRow(s))));
  });

  it('round-trips an EncryptedString through bulkEncrypt + bulkDecrypt', async () => {
    const rows = await db.orm.User.all();
    expect(rows).toHaveLength(SEED.length);
    await decryptAll(rows);
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    for (const s of SEED) {
      const r = byId.get(s.id);
      expect(r, `seed row ${s.id} present`).toBeDefined();
      expect(r ? await r.email.decrypt() : undefined).toBe(s.email);
    }
  });

  it('cipherstashGt filters lexicographically', async () => {
    const rows = await db.orm.User.where((u) => u.email.cipherstashGt('m')).all();
    expect(rows.map((r) => r.id).sort()).toEqual(['e2e-str-2', 'e2e-str-3']);
  });

  it('cipherstashAsc orders alphabetically (bare-column ORDER BY on string)', async () => {
    const rows = await db.orm.User.orderBy((u) => cipherstashAsc(u.email)).all();
    expect(rows.map((r) => r.id)).toEqual(['e2e-str-0', 'e2e-str-1', 'e2e-str-2', 'e2e-str-3']);
  });

  it('cipherstashDesc reverses the alphabetical order', async () => {
    const rows = await db.orm.User.orderBy((u) => cipherstashDesc(u.email)).all();
    expect(rows.map((r) => r.id)).toEqual(['e2e-str-3', 'e2e-str-2', 'e2e-str-1', 'e2e-str-0']);
  });

  it('cipherstashIlike coexists with order-and-range on the same column', async () => {
    const rows = await db.orm.User.where((u) => u.email.cipherstashIlike('%@example.com')).all();
    expect(rows.map((r) => r.id).sort()).toEqual(['e2e-str-0', 'e2e-str-1', 'e2e-str-2']);
  });
});
