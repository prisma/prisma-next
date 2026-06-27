import type { Contract as ContractBase } from '@prisma-next/contract/types';
import { expectTypeOf, test } from 'vitest';
import { PostgresContractView } from '../src/core/postgres-contract-view';
import type { CollisionContract } from './fixtures/collision-contract';
import type { Contract } from './fixtures/namespaced-contract.d';

/**
 * Emit-then-consume type tests against a REAL emitted multi-schema Postgres
 * contract (`test/fixtures/namespaced-contract.d.ts`). The fixture declares the
 * SAME bare table `users` in BOTH `public` (column `email`) and `auth` (column
 * `token`) — the discriminator that proves per-schema qualification. The
 * collision tests additionally use a typed hand-built contract whose schema is
 * named `storage` (see `fixtures/collision-contract.ts`).
 */

type CV = PostgresContractView<Contract>;

test('the view is assignable to Contract (superset)', () => {
  expectTypeOf<CV>().toMatchTypeOf<ContractBase>();
});

test('from() and fromJson() both return the view type', () => {
  expectTypeOf(PostgresContractView.from<Contract>).returns.toEqualTypeOf<CV>();
  expectTypeOf(PostgresContractView.fromJson<Contract>).returns.toEqualTypeOf<CV>();
});

test('each schema is its own key with its own table columns (root promotion)', () => {
  expectTypeOf<
    CV['public']['table']['users']['columns']['email']['codecId']
  >().toEqualTypeOf<'pg/text@1'>();
  expectTypeOf<
    CV['auth']['table']['users']['columns']['token']['codecId']
  >().toEqualTypeOf<'pg/text@1'>();
});

test('view.namespace.<id> reaches every schema by raw id', () => {
  expectTypeOf<
    CV['namespace']['public']['table']['users']['columns']['email']['codecId']
  >().toEqualTypeOf<'pg/text@1'>();
  expectTypeOf<
    CV['namespace']['auth']['table']['users']['columns']['token']['codecId']
  >().toEqualTypeOf<'pg/text@1'>();
});

test('cross-schema column access is a compile error', () => {
  const view = null as unknown as CV;
  // @ts-expect-error public.users has no `token` column (that is auth.users)
  view.public.table.users.columns.token;
  // @ts-expect-error auth.users has no `email` column (that is public.users)
  view.auth.table.users.columns.email;
});

test('a non-existent schema key is a compile error', () => {
  const view = null as unknown as CV;
  // @ts-expect-error 'marketing' is not an emitted schema
  view.marketing;
});

test('a non-existent table name in a schema is a compile error', () => {
  const view = null as unknown as CV;
  // @ts-expect-error 'orders' is not a table in the public schema
  view.public.table.orders;
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

test('view.<ns>.entries excludes the built-in table and valueSet keys', () => {
  type PublicEntries = CV['public']['entries'];
  type HasTable = 'table' extends keyof PublicEntries ? true : false;
  type HasValueSet = 'valueSet' extends keyof PublicEntries ? true : false;
  expectTypeOf<HasTable>().toEqualTypeOf<false>();
  expectTypeOf<HasValueSet>().toEqualTypeOf<false>();
});

// --- Collision: a schema named `storage` must not shadow the contract field ---

type Collision = PostgresContractView<CollisionContract>;

test('view.storage stays the contract field even when a schema is named `storage`', () => {
  // The contract envelope field wins at the root: `view.storage` carries
  // `.namespaces`, NOT the schema view (which would have `.table`).
  expectTypeOf<Collision['storage']['namespaces']>().toMatchTypeOf<object>();
  type StorageHasTable = 'table' extends keyof Collision['storage'] ? true : false;
  expectTypeOf<StorageHasTable>().toEqualTypeOf<false>();
});

test('the `storage`-named schema is reachable via view.namespace.storage', () => {
  expectTypeOf<
    Collision['namespace']['storage']['table']['secrets']['columns']['id']['codecId']
  >().toEqualTypeOf<'pg/int4@1'>();
});

test('a non-colliding schema (`public`) is still promoted to the root', () => {
  expectTypeOf<
    Collision['public']['table']['widgets']['columns']['id']['codecId']
  >().toEqualTypeOf<'pg/int4@1'>();
  expectTypeOf<
    Collision['namespace']['public']['table']['widgets']['columns']['id']['codecId']
  >().toEqualTypeOf<'pg/int4@1'>();
});

test('the collision view is still assignable to Contract', () => {
  expectTypeOf<Collision>().toMatchTypeOf<ContractBase>();
});
