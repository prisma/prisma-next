/**
 * End-to-end round-trip for `EncryptedDouble` against live
 * Postgres + EQL bundle + ZeroKMS.
 *
 * Pins:
 *   - INSERT + decrypt round-trip recovers the source numbers.
 *   - `cipherstashGt`, `cipherstashGte`, `cipherstashLt`,
 *     `cipherstashLte`, `cipherstashBetween` each filter rows
 *     correctly against the IEEE-754-encrypted column.
 *   - `cipherstashAsc` / `cipherstashDesc` produce numerically-
 *     sorted results via bare-column `ORDER BY` against the live
 *     EQL operator family. The cipherstash codec relies on the
 *     EQL bundle's overloads of `<` / `>` for `eql_v2_encrypted`,
 *     so an `ORDER BY <col>` clause sorts by the encrypted ORE
 *     value without requiring a wrapping helper.
 *
 * Seed: four rows with file-scoped ID prefix `e2e-num-`. The
 * `beforeAll` truncates `users` first so the file's assertions
 * count exact-match cardinalities (not "at-least-N").
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
  { id: 'e2e-num-0', salary: 50_000 },
  { id: 'e2e-num-1', salary: 95_000 },
  { id: 'e2e-num-2', salary: 120_000 },
  { id: 'e2e-num-3', salary: 200_000 },
] as const;

function seedRow(s: (typeof SEED)[number]) {
  return {
    id: s.id,
    email: EncryptedString.from(`${s.id}@example.com`),
    salary: EncryptedDouble.from(s.salary),
    accountId: EncryptedBigInt.from(1_000_000n),
    birthday: EncryptedDate.from(new Date('1990-01-01')),
    emailVerified: EncryptedBoolean.from(true),
    preferences: EncryptedJson.from({ marker: 'num' }),
  };
}

describe('EncryptedDouble e2e (live PG + EQL + ZeroKMS)', () => {
  beforeAll(async () => {
    await ensureConnected();
    truncateUsers();
    await Promise.all(SEED.map((s) => db.orm.User.create(seedRow(s))));
  });

  it('round-trips an EncryptedDouble through bulkEncrypt + bulkDecrypt', async () => {
    const rows = await db.orm.User.all();
    expect(rows).toHaveLength(SEED.length);
    await decryptAll(rows);
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    for (const s of SEED) {
      const r = byId.get(s.id);
      expect(r, `seed row ${s.id} present`).toBeDefined();
      expect(r ? await r.salary.decrypt() : undefined).toBe(s.salary);
    }
  });

  it('cipherstashGt filters by encrypted IEEE-754 numeric order', async () => {
    const rows = await db.orm.User.where((u) => u.salary.cipherstashGt(95_000)).all();
    expect(rows.map((r) => r.id).sort()).toEqual(['e2e-num-2', 'e2e-num-3']);
  });

  it('cipherstashGte includes the equality boundary', async () => {
    const rows = await db.orm.User.where((u) => u.salary.cipherstashGte(95_000)).all();
    expect(rows.map((r) => r.id).sort()).toEqual(['e2e-num-1', 'e2e-num-2', 'e2e-num-3']);
  });

  it('cipherstashLt filters strict-less-than', async () => {
    const rows = await db.orm.User.where((u) => u.salary.cipherstashLt(120_000)).all();
    expect(rows.map((r) => r.id).sort()).toEqual(['e2e-num-0', 'e2e-num-1']);
  });

  it('cipherstashLte includes the equality boundary', async () => {
    const rows = await db.orm.User.where((u) => u.salary.cipherstashLte(120_000)).all();
    expect(rows.map((r) => r.id).sort()).toEqual(['e2e-num-0', 'e2e-num-1', 'e2e-num-2']);
  });

  it('cipherstashBetween bounds inclusively on both sides', async () => {
    const rows = await db.orm.User.where((u) => u.salary.cipherstashBetween(95_000, 120_000)).all();
    expect(rows.map((r) => r.id).sort()).toEqual(['e2e-num-1', 'e2e-num-2']);
  });

  it('cipherstashAsc orders by numeric value (D8 bare-column verdict)', async () => {
    const rows = await db.orm.User.orderBy((u) => cipherstashAsc(u.salary)).all();
    expect(rows.map((r) => r.id)).toEqual(['e2e-num-0', 'e2e-num-1', 'e2e-num-2', 'e2e-num-3']);
  });

  it('cipherstashDesc reverses the ascending order', async () => {
    const rows = await db.orm.User.orderBy((u) => cipherstashDesc(u.salary)).all();
    expect(rows.map((r) => r.id)).toEqual(['e2e-num-3', 'e2e-num-2', 'e2e-num-1', 'e2e-num-0']);
  });
});
