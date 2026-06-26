import { expectTypeOf, test } from 'vitest';
import type { PostgresContractView } from '../src/core/postgres-contract-view';
import type { Contract } from './fixtures/namespaced-contract.d';

/**
 * Emit-then-consume type tests against a REAL emitted multi-schema Postgres
 * contract (`test/fixtures/namespaced-contract.d.ts`). The fixture declares the
 * SAME bare table `users` in BOTH `public` (column `email`) and `auth` (column
 * `token`) — the discriminator that proves per-schema qualification.
 */

type CV = ReturnType<typeof PostgresContractView.from<Contract>>;

test('each schema is its own key with its own table columns', () => {
  expectTypeOf<
    CV['public']['table']['users']['columns']['email']['codecId']
  >().toEqualTypeOf<'pg/text@1'>();
  expectTypeOf<
    CV['auth']['table']['users']['columns']['token']['codecId']
  >().toEqualTypeOf<'pg/text@1'>();
});

test('cross-schema column access is a compile error', () => {
  const cv = null as unknown as CV;
  // @ts-expect-error public.users has no `token` column (that is auth.users)
  cv.public.table.users.columns.token;
  // @ts-expect-error auth.users has no `email` column (that is public.users)
  cv.auth.table.users.columns.email;
});

test('a non-existent schema key is a compile error', () => {
  const cv = null as unknown as CV;
  // @ts-expect-error 'marketing' is not an emitted schema
  cv.marketing;
});

test('a non-existent table name in a schema is a compile error', () => {
  const cv = null as unknown as CV;
  // @ts-expect-error 'orders' is not a table in the public schema
  cv.public.table.orders;
});

test('the cross-schema foreign key on public.profile is reachable', () => {
  expectTypeOf<
    CV['public']['table']['profile']['foreignKeys'][0]['target']['namespaceId']
  >().toEqualTypeOf<'auth' & import('@prisma-next/contract/types').NamespaceId>();
});

test('valueSet slot is present per schema (none emitted, so empty maps)', () => {
  expectTypeOf<CV['public']['valueSet']>().toEqualTypeOf<Record<string, never>>();
  expectTypeOf<CV['auth']['valueSet']>().toEqualTypeOf<Record<string, never>>();
});

test('cv.<ns>.entries excludes the built-in table and valueSet keys', () => {
  type PublicEntries = CV['public']['entries'];
  type HasTable = 'table' extends keyof PublicEntries ? true : false;
  type HasValueSet = 'valueSet' extends keyof PublicEntries ? true : false;
  expectTypeOf<HasTable>().toEqualTypeOf<false>();
  expectTypeOf<HasValueSet>().toEqualTypeOf<false>();
});
