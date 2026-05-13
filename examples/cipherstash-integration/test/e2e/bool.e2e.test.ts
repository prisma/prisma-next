/**
 * End-to-end round-trip for `EncryptedBoolean` against live
 * Postgres + EQL bundle + ZeroKMS.
 *
 * Booleans surface only the equality-trait operators (no
 * order-and-range) so this file pins:
 *   - INSERT + decrypt round-trip recovers `true` / `false`.
 *   - Equality filters to the matching set. Note: `cipherstashEq` is
 *     the legacy single-codec operator pinned to `cipherstash/string@1`.
 *     For non-string equality, the trait-namespaced
 *     `cipherstashInArray([value])` is the canonical form (see
 *     `src/index.ts`'s boolean demo). We exercise
 *     `cipherstashInArray` (the trait-dispatched live form) and
 *     `cipherstashNe` (the inequality direction).
 */

import {
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
  { id: 'e2e-bool-0', emailVerified: true },
  { id: 'e2e-bool-1', emailVerified: false },
  { id: 'e2e-bool-2', emailVerified: true },
  { id: 'e2e-bool-3', emailVerified: false },
] as const;

function seedRow(s: (typeof SEED)[number]) {
  return {
    id: s.id,
    email: EncryptedString.from(`${s.id}@example.com`),
    salary: EncryptedDouble.from(50_000),
    accountId: EncryptedBigInt.from(1_000_000n),
    birthday: EncryptedDate.from(new Date('1990-01-01')),
    emailVerified: EncryptedBoolean.from(s.emailVerified),
    preferences: EncryptedJson.from({ marker: 'bool' }),
  };
}

describe('EncryptedBoolean e2e (live PG + EQL + ZeroKMS)', () => {
  beforeAll(async () => {
    await ensureConnected();
    truncateUsers();
    await Promise.all(SEED.map((s) => db.orm.User.create(seedRow(s))));
  });

  it('round-trips an EncryptedBoolean through bulkEncrypt + bulkDecrypt', async () => {
    const rows = await db.orm.User.all();
    expect(rows).toHaveLength(SEED.length);
    await decryptAll(rows);
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    for (const s of SEED) {
      const r = byId.get(s.id);
      expect(r, `seed row ${s.id} present`).toBeDefined();
      expect(r ? await r.emailVerified.decrypt() : undefined).toBe(s.emailVerified);
    }
  });

  it('cipherstashInArray([true]) returns the verified subset', async () => {
    const rows = await db.orm.User.where((u) => u.emailVerified.cipherstashInArray([true])).all();
    expect(rows.map((r) => r.id).sort()).toEqual(['e2e-bool-0', 'e2e-bool-2']);
  });

  it('cipherstashInArray([false]) returns the unverified subset', async () => {
    const rows = await db.orm.User.where((u) => u.emailVerified.cipherstashInArray([false])).all();
    expect(rows.map((r) => r.id).sort()).toEqual(['e2e-bool-1', 'e2e-bool-3']);
  });

  it('cipherstashInArray([true, false]) returns the entire population', async () => {
    const rows = await db.orm.User.where((u) =>
      u.emailVerified.cipherstashInArray([true, false]),
    ).all();
    expect(rows.map((r) => r.id).sort()).toEqual([
      'e2e-bool-0',
      'e2e-bool-1',
      'e2e-bool-2',
      'e2e-bool-3',
    ]);
  });

  it('cipherstashNe([true]) excludes the equality match', async () => {
    const rows = await db.orm.User.where((u) => u.emailVerified.cipherstashNe(true)).all();
    expect(rows.map((r) => r.id).sort()).toEqual(['e2e-bool-1', 'e2e-bool-3']);
  });
});
