/**
 * End-to-end round-trip for `EncryptedDate` against live
 * Postgres + EQL bundle + ZeroKMS.
 *
 * Pins:
 *   - INSERT + decrypt round-trip recovers the source `Date`.
 *   - `cipherstashGt(<date>)` returns rows whose date is later.
 *   - `cipherstashAsc` orders by calendar date.
 *   - `cipherstashBetween` filters a closed interval.
 *
 * Encoded form is ISO 8601 (`.toISOString()`); both ZeroKMS and the
 * EQL bundle accept the textual form for `cast_as: 'date'`.
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
  { id: 'e2e-date-0', birthday: new Date('1980-05-10') },
  { id: 'e2e-date-1', birthday: new Date('1990-04-12') },
  { id: 'e2e-date-2', birthday: new Date('2000-11-30') },
  { id: 'e2e-date-3', birthday: new Date('2010-01-01') },
] as const;

function seedRow(s: (typeof SEED)[number]) {
  return {
    id: s.id,
    email: EncryptedString.from(`${s.id}@example.com`),
    salary: EncryptedDouble.from(50_000),
    accountId: EncryptedBigInt.from(1_000_000n),
    birthday: EncryptedDate.from(s.birthday),
    emailVerified: EncryptedBoolean.from(true),
    preferences: EncryptedJson.from({ marker: 'date' }),
  };
}

describe('EncryptedDate e2e (live PG + EQL + ZeroKMS)', () => {
  beforeAll(async () => {
    await ensureConnected();
    truncateUsers();
    await Promise.all(SEED.map((s) => db.orm.User.create(seedRow(s))));
  });

  it('round-trips an EncryptedDate through bulkEncrypt + bulkDecrypt', async () => {
    const rows = await db.orm.User.all();
    expect(rows).toHaveLength(SEED.length);
    await decryptAll(rows);
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    for (const s of SEED) {
      const r = byId.get(s.id);
      expect(r, `seed row ${s.id} present`).toBeDefined();
      const got = r ? await r.birthday.decrypt() : undefined;
      // The cipherstash date codec round-trips through `cast_as: 'date'`
      // which is calendar-day-precision; comparing day-equivalence is
      // the meaningful assertion.
      expect(got).toBeInstanceOf(Date);
      expect((got as Date).toISOString().slice(0, 10)).toBe(s.birthday.toISOString().slice(0, 10));
    }
  });

  it('cipherstashGt filters dates after the cutoff', async () => {
    const rows = await db.orm.User.where((u) =>
      u.birthday.cipherstashGt(new Date('1995-01-01')),
    ).all();
    expect(rows.map((r) => r.id).sort()).toEqual(['e2e-date-2', 'e2e-date-3']);
  });

  it('cipherstashBetween filters a closed date interval', async () => {
    const rows = await db.orm.User.where((u) =>
      u.birthday.cipherstashBetween(new Date('1985-01-01'), new Date('2005-12-31')),
    ).all();
    expect(rows.map((r) => r.id).sort()).toEqual(['e2e-date-1', 'e2e-date-2']);
  });

  it('cipherstashAsc orders by calendar date (bare-column ORDER BY)', async () => {
    const rows = await db.orm.User.orderBy((u) => cipherstashAsc(u.birthday)).all();
    expect(rows.map((r) => r.id)).toEqual(['e2e-date-0', 'e2e-date-1', 'e2e-date-2', 'e2e-date-3']);
  });

  it('cipherstashDesc reverses the date order', async () => {
    const rows = await db.orm.User.orderBy((u) => cipherstashDesc(u.birthday)).all();
    expect(rows.map((r) => r.id)).toEqual(['e2e-date-3', 'e2e-date-2', 'e2e-date-1', 'e2e-date-0']);
  });
});
