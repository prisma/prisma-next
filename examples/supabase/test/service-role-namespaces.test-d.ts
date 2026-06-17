/**
 * Type-level invariants for Slice D — the service_role namespace surface.
 *
 * Typed with the real example app contract (`../src/contract`), which declares
 * only the `public` namespace (with `profile`) and has no `auth` / `storage`.
 * That is the whole point: the negative assertions below would be vacuous
 * against a contract that already carried `auth` / `storage`.
 *
 * Proven here:
 *   1. `asServiceRole().sql` GAINS `auth` and `storage` (via
 *      `WithExtensionNamespaces`) on top of the app's own `public`.
 *   2. `asAnon().sql` and `asUser(jwt).sql` do NOT expose `auth` / `storage` —
 *      those namespaces are reachable only over the service_role connection.
 */

import type { RoleBoundDb, SupabaseDb } from '@prisma-next/extension-supabase/runtime';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../src/contract';

const db = {} as SupabaseDb<Contract>;

test('app contract declares public but not auth/storage', () => {
  expectTypeOf(db.asAnon().sql).toHaveProperty('public');
  expectTypeOf(db.asAnon().sql).not.toHaveProperty('auth');
  expectTypeOf(db.asAnon().sql).not.toHaveProperty('storage');
});

test('asServiceRole().sql gains auth and storage alongside public', () => {
  const sr = db.asServiceRole();
  expectTypeOf(sr.sql).toHaveProperty('public');
  expectTypeOf(sr.sql).toHaveProperty('auth');
  expectTypeOf(sr.sql).toHaveProperty('storage');
});

test('asAnon().sql does not expose auth or storage', () => {
  const anon = db.asAnon();
  expectTypeOf(anon.sql).not.toHaveProperty('auth');
  expectTypeOf(anon.sql).not.toHaveProperty('storage');
});

test('asUser(jwt).sql does not expose auth or storage', async () => {
  const user = await db.asUser('jwt');
  expectTypeOf(user.sql).not.toHaveProperty('auth');
  expectTypeOf(user.sql).not.toHaveProperty('storage');
});

test('asAnon() and asUser() return the unchanged app contract', async () => {
  expectTypeOf(db.asAnon()).toEqualTypeOf<RoleBoundDb<Contract>>();
  expectTypeOf(await db.asUser('jwt')).toEqualTypeOf<RoleBoundDb<Contract>>();
});
