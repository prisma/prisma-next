import type { Namespace, TableProxy } from '@prisma-next/sql-builder/types';
import { expectTypeOf, test } from 'vitest';
import type { SqliteClient } from '../src/runtime/sqlite';
import type { Contract } from './fixtures/namespaced-contract';

declare const db: SqliteClient<Contract>;

test('db.sql exposes the flat surface via the unbound-namespace alias', () => {
  expectTypeOf(db.sql.users).toEqualTypeOf<TableProxy<Contract, 'users'>>();
  expectTypeOf<Namespace<Contract, '__unbound__'>['users']>().toEqualTypeOf<
    TableProxy<Contract, 'users'>
  >();
});

test('db.orm exposes the flat surface via the unbound-namespace alias', () => {
  expectTypeOf(db.orm.User).toHaveProperty('all');
});

test('the qualified namespace map is gone — db.sql/db.orm are the unbound facet', () => {
  // @ts-expect-error db.sql is the unbound facet, not a namespace map
  db.sql.__unbound__;
  // @ts-expect-error db.orm is the unbound facet, not a namespace map
  db.orm.__unbound__;
});

test('an undeclared key is not on db.sql or db.orm', () => {
  // @ts-expect-error 'auth' is neither a table on the unbound sql facet
  db.sql.auth;
  // @ts-expect-error 'auth' is neither a model on the unbound orm facet
  db.orm.auth;
});

test('prepare callback receives the flat (unbound-facet) sql surface', () => {
  type PrepareSql = Parameters<Parameters<SqliteClient<Contract>['prepare']>[1]>[0];
  expectTypeOf<PrepareSql['users']>().toEqualTypeOf<TableProxy<Contract, 'users'>>();
  // @ts-expect-error the qualified namespace map is gone on the unbound-aliased facade
  type _Qualified = PrepareSql['__unbound__'];
});
