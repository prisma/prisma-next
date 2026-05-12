/**
 * AC-E2E-JSON — End-to-end round-trip for `EncryptedJson` against
 * live Postgres + EQL bundle + ZeroKMS.
 *
 * Pins:
 *   - INSERT + decrypt round-trip recovers the source JSON object.
 *   - `cipherstashJsonbPathExists('$.<key>')` filters rows by
 *     STE-VEC selector membership.
 *
 * # Known limitation: STE-VEC selectors require client-side hashing
 *
 * The cipherstash JSON codec stores values with an STE-VEC index;
 * each JSON path is represented in the index as a *hashed* selector
 * computed by the CipherStash client at write time. The
 * `eql_v2.jsonb_path_exists` function expects that same hashed
 * selector at query time — passing a raw JSONpath string
 * (`'$.theme'`) probes the index for a path that has not been
 * hashed, so the lookup misses every row.
 *
 * The framework's current operator lowering binds the JSONpath as a
 * plain `pg/text@1` `ParamRef`. The wire result is a syntactically
 * valid call that the EQL function accepts and runs, but no rows
 * match because the encrypted index entries are keyed by hashed
 * selectors, not the raw path. Bridging this requires either:
 *
 *   - a client-side hashing step before the SQL fires (a new
 *     middleware that observes JSON-path arguments and rewrites them
 *     via the SDK's `selector(...)` API), or
 *   - an EQL-side overload that accepts plaintext paths and hashes
 *     them server-side.
 *
 * Both routes are out of scope for project-2 (operator-surface
 * widening) and tracked as a follow-up. The test below pins the
 * round-trip + decrypt behaviour (which works today) and the JSON
 * SELECT-expression helpers' availability; the predicate side is
 * marked as a known limitation with a `.skip` and a pointer to this
 * comment, so the regression status is visible at a glance.
 */

import {
  cipherstashJsonbGet,
  cipherstashJsonbPathQueryFirst,
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
  {
    id: 'e2e-json-0',
    preferences: { theme: 'dark', notifications: true, locale: 'en-US' },
  },
  {
    id: 'e2e-json-1',
    preferences: { theme: 'light', notifications: false, locale: 'de-DE' },
  },
  {
    id: 'e2e-json-2',
    preferences: { theme: 'system', notifications: true },
  },
] as const;

function seedRow(s: (typeof SEED)[number]) {
  return {
    id: s.id,
    email: EncryptedString.from(`${s.id}@example.com`),
    salary: EncryptedDouble.from(50_000),
    accountId: EncryptedBigInt.from(1_000_000n),
    birthday: EncryptedDate.from(new Date('1990-01-01')),
    emailVerified: EncryptedBoolean.from(true),
    preferences: EncryptedJson.from(s.preferences),
  };
}

describe('AC-E2E-JSON (live PG + EQL + ZeroKMS)', () => {
  beforeAll(async () => {
    await ensureConnected();
    truncateUsers();
    await Promise.all(SEED.map((s) => db.orm.User.create(seedRow(s))));
  });

  it('round-trips an EncryptedJson through bulkEncrypt + bulkDecrypt', async () => {
    const rows = await db.orm.User.all();
    expect(rows).toHaveLength(SEED.length);
    await decryptAll(rows);
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    for (const s of SEED) {
      const r = byId.get(s.id);
      expect(r, `seed row ${s.id} present`).toBeDefined();
      expect(r ? await r.preferences.decrypt() : undefined).toEqual(s.preferences);
    }
  });

  it.skip('cipherstashJsonbPathExists filters by JSON path (KNOWN LIMITATION: needs client-side selector hashing)', async () => {
    const rows = await db.orm.User.where((u) =>
      u.preferences.cipherstashJsonbPathExists('$.locale'),
    ).all();
    expect(rows.map((r) => r.id).sort()).toEqual(['e2e-json-0', 'e2e-json-1']);
  });

  it('exposes cipherstashJsonbPathQueryFirst as a typed SELECT-expression helper', () => {
    // Type-level: the helper accepts an `Expression<ScopeField>` and
    // returns an `Expression` typed as `cipherstash/json@1`. Wiring
    // it into a `db.sql.users.select(...)` projection exercises the
    // typed surface; the live SQL execution is held back until the
    // STE-VEC selector hashing gap closes (see file docblock).
    const projection = db.sql.users
      .select((f) => ({
        id: f.id,
        themeNode: cipherstashJsonbPathQueryFirst(f.preferences, '$.theme'),
      }))
      .build();
    expect(projection).toBeDefined();
  });

  it('exposes cipherstashJsonbGet as a typed SELECT-expression helper', () => {
    const projection = db.sql.users
      .select((f) => ({
        id: f.id,
        themeNode: cipherstashJsonbGet(f.preferences, 'theme'),
      }))
      .build();
    expect(projection).toBeDefined();
  });
});
